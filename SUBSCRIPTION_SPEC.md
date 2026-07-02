# Spec: Monthly Membership / Subscription Access

> **Status: NOT built — plan only.** The app today is "pay once, use forever."
> This spec describes what it takes to move to (or offer) a recurring membership
> and to truly cut off access when someone cancels or is revoked.

## Why this isn't automatic today
Access is gated **only by having a Supabase auth login**. The license/key is
checked *once* at activation (`server/src/routes/register.js`), an account is
created, and after that nothing re-checks the license. So:

- The **webhook** (`server/src/routes/webhooks.js`) only handles the *initial
  purchase* — it always **grants** access and ignores cancellations/refunds.
- **Revoking a key** in the admin panel only blocks it from activating a *new*
  account. It does **not** kick out someone who already activated.

## What "monthly membership" requires (3 pieces)

### 1. Recurring-billing webhook handling
Extend `webhooks.js` to handle ClickFunnels **subscription** events, not just the
first sale:
- `invoice.paid` / rebill success → keep the member **active**, extend
  `current_period_end`.
- `subscription.payment_failed` (dunning) → optional grace period, then set
  **inactive**.
- `subscription.cancelled` / `refunded` → set **inactive**.
- (Confirm exact event names/shapes in ClickFunnels 2.0 outgoing webhooks; the
  existing signature verification + `extractFields()` can be reused.)

### 2. An ongoing entitlement check (the core missing piece)
- Add a server endpoint, e.g. `GET /api/entitlement`, that returns
  `{ active, plan, currentPeriodEnd }` for the signed-in user (looked up by email
  in `approved_buyers`).
- The client checks it **on login** (in `AuthContext` after `getSession`) and
  periodically / on focus. Cache briefly so it's not every request.

### 3. A gated "expired / renew" experience
- If `active === false`, block the app and show a **Renew** screen with a link to
  the ClickFunnels re-subscribe page — instead of letting them into the app.
- Keep sign-in working so they can re-enter the moment their payment goes through.

## Data model changes (small)
Add to `approved_buyers` (migration, run once in Supabase SQL editor):
```sql
alter table public.approved_buyers
  add column if not exists plan text not null default 'lifetime'
    check (plan in ('lifetime','subscription')),
  add column if not exists status text not null default 'active'
    check (status in ('active','past_due','canceled')),
  add column if not exists current_period_end timestamptz,
  add column if not exists cf_subscription_id text;
create index if not exists approved_buyers_sub_idx
  on public.approved_buyers (cf_subscription_id);
```
(`active` boolean can stay for back-compat; `status` is the richer field.)

## IMPORTANT: grandfather existing buyers
Everyone who bought under "pay once, forever" must keep access when we flip to
subscriptions. That's what `plan = 'lifetime'` is for — the entitlement check
treats `plan = 'lifetime'` as always active, and only enforces status on
`plan = 'subscription'` members. Backfill all current `approved_buyers` rows to
`plan = 'lifetime'` before turning enforcement on.

## Edge cases to handle
- **Grace period / dunning** before cutting access on a failed payment.
- **Reactivation** — a canceled member who resubscribes flips back to active.
- **Refund on a first purchase** — revoke access + optionally delete the account.
- **Manual revoke** from admin should also flip `status = 'canceled'` so the
  entitlement check catches it (today revoke doesn't affect existing users).
- **Offline / API-down** — fail *open* (don't lock paying members out if the
  entitlement endpoint is unreachable); only lock on a definite "inactive."

## Rollout order (safe)
1. Add DB columns + backfill everyone to `plan = 'lifetime'`.
2. Ship the entitlement endpoint + client check, but with enforcement **off**
   (log only) to confirm nobody legit is flagged.
3. Add the subscription webhook handlers.
4. Turn on the "expired/renew" gate for `plan = 'subscription'` only.

## Files this touches
- `server/src/routes/webhooks.js` — subscription events
- `server/src/routes/entitlement.js` (new) — the check endpoint
- `server/src/index.js` — mount the new route
- `client/src/context/AuthContext.jsx` — call entitlement on session
- `client/src/App.jsx` — gate on entitlement, add the Renew screen
- Admin panel — surface subscription status + a "cancel/reactivate" action
