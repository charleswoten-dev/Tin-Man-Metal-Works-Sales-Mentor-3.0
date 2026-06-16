# Pricing & Quotes Module — Build Spec

**Project:** Tin Man Metal Works Sales Mentor 3.0
**Author:** drafted for Charles Woten
**Date:** 2026-06-16
**Status:** Draft for review — no code written until sign-off

---

## 1. Why this exists

Web research across welding/fabrication forums, CNC-plasma pricing guides, and ~30 existing
pricing tools shows the **#1 recurring pain** of our target user (solo / small CNC-plasma & metal-fab
owners) is **undercharging because they don't know their numbers**. Guys bill $20/hr when the
market floor is $40–135/hr; they forget consumables, setup, CAD time, and that they don't bill 100%
of their hours.

Existing tools fall into three buckets, none of which serve our user:
- **Dumb single-input web calculators** (free, no memory, no coaching).
- **Enterprise MES/estimating suites** (Costimator, Tempus, MIE Trak — overkill, $$$, demo-gated).
- **Etsy/maker calculators** (aimed at jewelry/crafts, not fab).

**Our wedge:** a transparent shop-rate-from-*your-own-costs* engine **+** a plasma-aware job
calculator **+** the AI mentor interpreting the number and coaching the owner **+** it living
*inside the sales system* (quotes attach to projects; the mentor cites them on a call). No competitor
combines these.

---

## 2. Scope

### In scope (v1)
- New `/pricing` sidebar view with three tabs: **Build My Shop Rate**, **Quote a Job**, **Saved Quotes**.
- Two Supabase tables: `shop_rate` (one row per user) and `quotes` (many per user, optionally tied to a project).
- Shop-rate calculation in **two modes**: cost-build-up and income-goal (work-back-from-target).
- Per-job calculator with plasma-aware inputs, per-part + total output, margin check.
- AI mentor integration: the system prompt learns the user's shop rate so Chat can coach quotes.
- Cross-feature hooks: quote → project, finished-job → Win Wall (deferred to v1.1, see §9).

### Out of scope (v1) — deliberately
- DXF/DWG upload, auto-nesting, CAD cut-path time estimation (huge lift; our user often has no clean CAD).
- Multi-employee / department overhead allocation (single-owner model only).
- Live material-price API feeds.
- PDF generation (v1 shows an on-screen "customer-facing quote" the AI drafts; PDF export is v1.1).

---

## 3. The math (formulas)

All formulas validated against Eziil's industry methodology + Harvest's freelancer model.

### 3.1 Shop rate — Mode A: Cost build-up (default)

```
labor_cost_hr      = wage_hr × (1 + burden_pct/100)        // burden default 30%
billable_hours_mo  = work_hours_week × 4.33 × (billable_pct/100)   // billable default 65%
machine_cost_hr    = machine_monthly_cost / billable_hours_mo
overhead_cost_hr   = overhead_monthly / billable_hours_mo
total_cost_hr      = labor_cost_hr + machine_cost_hr + overhead_cost_hr   // = BREAK-EVEN rate
shop_rate_hr       = total_cost_hr / (1 - margin_pct/100)   // margin default 32% (gross margin, NOT markup)
```

- **`total_cost_hr` is the break-even rate** (the floor — charge less and you lose money).
- **`shop_rate_hr` is the recommended rate.** Show BOTH (Harvest pattern).
- **Margin vs. markup:** we use **gross margin** (`price = cost / (1 - margin)`), and label it clearly.
  A 32% margin ≠ a 32% markup — the UI must not conflate them. Show the equivalent markup as a helper.

### 3.2 Shop rate — Mode B: Income goal (work-back)

```
billable_hours_yr  = work_hours_week × work_weeks_yr × (billable_pct/100)
shop_rate_hr       = (target_income_yr + annual_expenses) / billable_hours_yr
```

Lets the owner ask "I want to take home $X — what must I charge?" Output feeds the same job calculator.

### 3.3 Per-job quote

```
material_billed = material_cost × (1 + scrap_pct/100) × material_markup   // markup default 1.5×, scrap default 5%
cut_cost        = pierces × cost_per_pierce + cut_inches × cost_per_inch   // defaults $0.18/pierce, $0.15/in
time_hours      = run_minutes/60 + cad_hours + setup_hours
time_cost       = time_hours × shop_rate_hr
unit_price      = material_billed + cut_cost + time_cost
total_price     = unit_price × quantity
job_cost        = (material_cost × (1+scrap_pct/100)) + cut_cost + time_hours × total_cost_hr
job_profit      = total_price - (job_cost × quantity)
```

- Output **cost per part AND total job** (FastCut pattern) — essential for batch runs.
- Show **job_profit** in `$` and `%` (Craftybase pattern).
- **Sanity guard:** if `shop_rate_hr < 35`, flag it ("below the market floor we found — your inputs are likely missing consumables wear or overhead").

### 3.4 Default constants (EDITABLE — calibrate with Charles before shipping)

| Constant | Default | Source | Note |
|---|---|---|---|
| `burden_pct` | 30% | Eziil (29–31%) | payroll tax, insurance, PTO |
| `billable_pct` | 65% | Harvest (50–70%) | the big undercharging fix |
| `margin_pct` | 32% | Eziil (30–35% custom-fab norm) | gross margin |
| `material_markup` | 1.5 | plasma forums | ×150% of purchase |
| `scrap_pct` | 5% | Eziil (2–7%) | drop you can't reuse |
| `cost_per_pierce` | $0.18 | forums ($0.18–0.20) | |
| `cost_per_inch` | $0.15 | forums | linear inch of cut |
| market floor warning | $35/hr | forums | sanity guard |

> ⚠️ **These are forum-sourced placeholders.** Calibrate against Charles's real CNC-plasma shop
> numbers before defaults ship, so the app is trustworthy out of the box.

---

## 4. Database schema

Append to `supabase/schema.sql` (safe to re-run, matches existing conventions). RLS = own-rows-only,
same pattern as `projects` / `project_steps`. Includes the `set_updated_at` trigger.

```sql
-- ============================================================================
--  PRICING  (Added 2026-06-16)
--  shop_rate: one row per user (their cost basis). quotes: saved job estimates.
-- ============================================================================

-- 12. SHOP_RATE  (one row per user — the saved cost basis behind every quote)
create table if not exists public.shop_rate (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  mode                 text not null default 'cost'  check (mode in ('cost','income')),
  -- Mode A: cost build-up
  wage_hr              numeric,
  burden_pct           numeric default 30,
  machine_monthly_cost numeric,
  overhead_monthly     numeric,
  work_hours_week      numeric default 40,
  billable_pct         numeric default 65,
  margin_pct           numeric default 32,
  -- Mode B: income goal
  target_income_yr     numeric,
  annual_expenses      numeric,
  work_weeks_yr        numeric default 50,
  -- job-calc defaults (per user, editable)
  material_markup      numeric default 1.5,
  scrap_pct            numeric default 5,
  cost_per_pierce      numeric default 0.18,
  cost_per_inch        numeric default 0.15,
  -- cached result (computed client-side, stored for the AI + sidebar to read cheaply)
  computed_rate_hr     numeric,
  computed_breakeven_hr numeric,
  updated_at           timestamptz not null default now()
);

-- 13. QUOTES  (saved job estimates; optionally linked to a project)
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  title           text not null,
  -- inputs (stored so a quote can be re-opened / cloned)
  material_cost   numeric,
  pierces         integer,
  cut_inches      numeric,
  run_minutes     numeric,
  cad_hours       numeric,
  setup_hours     numeric,
  quantity        integer default 1,
  -- snapshot of the rate + constants used (so old quotes don't change when the rate changes)
  rate_hr_used    numeric,
  -- computed outputs
  unit_price      numeric,
  total_price     numeric,
  job_profit      numeric,
  status          text not null default 'draft'
                  check (status in ('draft','sent','won','lost')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists quotes_user_idx on public.quotes (user_id, created_at desc);
create index if not exists quotes_project_idx on public.quotes (project_id);

-- own rows only ---------------------------------------------------------------
alter table public.shop_rate enable row level security;
alter table public.quotes    enable row level security;

drop policy if exists "shop_rate_all_own" on public.shop_rate;
create policy "shop_rate_all_own" on public.shop_rate
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "quotes_all_own" on public.quotes;
create policy "quotes_all_own" on public.quotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep updated_at fresh
drop trigger if exists shop_rate_set_updated_at on public.shop_rate;
create trigger shop_rate_set_updated_at
  before update on public.shop_rate
  for each row execute function public.set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();
```

**Design notes**
- `shop_rate.user_id` is the PK (enforces one row per user; upsert on `user_id`).
- `quotes.rate_hr_used` snapshots the rate so editing the shop rate later never silently rewrites old quotes.
- `quote.status` (draft/sent/won/lost) gives us win-rate data for free → feeds ybr-17 Track Your Numbers.
- All numeric inputs nullable so a half-finished setup persists.

---

## 5. Client architecture

### 5.1 Files to add
```
client/src/views/Pricing.jsx          // the view, 3 tabs
client/src/views/Pricing.css           // dark-metal styling (mirrors WinWall.css/StartFreshModal.css tokens)
client/src/lib/pricing.js              // pure calc functions (computeShopRate, computeQuote) — unit-testable
```

### 5.2 Files to edit
- **`client/src/App.jsx`** — add route inside the authed `<Layout>` block:
  ```jsx
  import Pricing from './views/Pricing.jsx';
  ...
  <Route path="/pricing" element={<Pricing />} />
  ```
- **`client/src/components/Sidebar.jsx`** — add nav item under Chat, above "My Projects":
  ```jsx
  import { PricingIcon } from './Icons.jsx';   // new icon (calculator)
  <NavItem to="/pricing" icon={PricingIcon} label="Pricing" />
  ```
- **`client/src/components/Icons.jsx`** — add a `PricingIcon` (calculator/dollar SVG, stroke `currentColor`).

### 5.3 `lib/pricing.js` (pure functions — no React, no Supabase)
```js
export function computeShopRate(r) { /* §3.1 / §3.2 → { breakeven_hr, rate_hr, markup_equiv } */ }
export function computeQuote(q, rate_hr, breakeven_hr, consts) { /* §3.3 → { unit_price, total_price, job_profit, job_profit_pct, below_floor } */ }
```
Keeping math pure means we can add a tiny test later and the AI/server can reuse the same logic.

### 5.4 Pricing.jsx behavior
- On mount: `select * from shop_rate where user_id = me` → hydrate form (or defaults from §3.4).
- Live recompute on every input change (controlled inputs, same as the mockup).
- **Save shop rate:** upsert `shop_rate` on `user_id`, write `computed_rate_hr` + `computed_breakeven_hr`,
  then `window.dispatchEvent(new Event('tinman:projects-changed'))` so the sidebar/AI can pick it up.
- **Quote a Job tab:** pulls `computed_rate_hr`; if none saved yet, nudge "Build your shop rate first."
- **Save quote:** insert into `quotes` with `rate_hr_used` snapshot; optional project dropdown
  (reuse the projects list already loaded in Layout / fetch via supabase).
- **Saved Quotes tab:** list user's quotes, show status chip, **Clone** button (Accuracy-Quoting pattern —
  duplicate row as a new draft), and a status selector (draft→sent→won→lost).
- **"Send to Chat mentor"** button: navigate to `/chat` with nav state `{ autosend: <quote summary prompt> }`
  (reuses the existing Chat autosend mechanism).

### 5.5 Styling
- Reuse CSS vars: `--green #00C853`, `--green-bright #00E676`, `--bg #1a1a1a`, `--card #242424`,
  `--sidebar #111`, `--border #2a2a2a`, `--text #e0e0e0`, `--radius 12px`, `--radius-lg 16px`.
- Layout follows `pricing-mockup.html` (already approved visually): segmented tabs, two-column grid,
  big green result block, amber sanity-flag, AI interpretation line.

---

## 6. Server / AI mentor integration

- **`server/src/lib/systemPrompt.js`** — inject the user's saved shop rate into the system prompt
  (the server already loads the profile; also fetch `shop_rate`). Add a section like:
  ```
  THIS OWNER'S NUMBERS (from their Pricing setup):
  - True shop rate: ${rate_hr}/hr   - Break-even: ${breakeven_hr}/hr
  When they discuss a job or price, reference these. If a quoted price implies a rate below
  break-even, tell them plainly and help rework it. Never let them undercharge.
  ```
- Add a short **pricing-methodology block** to the prompt so the mentor can coach quotes
  conversationally (the §3 formulas in plain language), even when the user is in Chat not the calculator.
- No new server endpoint needed for v1 — the client reads/writes `shop_rate`/`quotes` directly via
  Supabase RLS (same as projects). The server only *reads* `shop_rate` when assembling the prompt.

---

## 7. Where it sits in the YBR system

- Add as a **conceptual companion to the existing 17 steps**, surfaced as its own sidebar page
  (not renumbering any `ybr-*` step_key — those are stable IDs in `progress`/`project_steps`).
- Natural pairing: prompt the user toward Pricing right after **ybr-5 Ruby Slipper Offer**
  ("you've built the offer — now let's price it so it actually profits").
- `quote.status` win/loss data later powers **ybr-17 Track Your Numbers** (quote→win rate, avg job value).

---

## 8. Build phases (task breakdown)

1. **Schema** — append §4 to `supabase/schema.sql`; run in Supabase SQL editor; verify RLS with a test select.
2. **Pure math** — write `lib/pricing.js` (both shop-rate modes + quote). Eyeball against the mockup numbers.
3. **Icon + nav + route** — `PricingIcon`, Sidebar item, App.jsx route. Verify the page loads behind auth.
4. **Build My Shop Rate tab** — form, dual-mode toggle, live calc, break-even vs recommended, save/upsert.
5. **Quote a Job tab** — form, live calc, per-part + total, profit, sanity flag, save quote (+ project link).
6. **Saved Quotes tab** — list, status chips, clone, status change, "send to Chat".
7. **AI integration** — inject shop rate + methodology into `systemPrompt.js`; restart server; verify mentor cites the rate.
8. **Verify end-to-end** — set a rate, quote the Ranch Gate Sign job, save it to a project, confirm it shows
   in Saved Quotes and the mentor references the rate in Chat.

Each phase verified in the browser before moving on (matches existing workflow's confirmation gates).

---

## 9. Deferred to v1.1 (noted, not built)
- **Customer-facing PDF export** of a quote (Tempus/Accuracy pattern).
- **Finished-job photo → Win Wall** cross-post (delivery-proof → social proof loop).
- **Channel-aware net profit** (subtract Etsy/marketplace fees) for the art/sign-seller segment (Craftybase pattern).
- **Quote → work order / job** conversion linking deeper into Progress.
- A tiny unit-test file for `lib/pricing.js`.

---

## 10. Open questions for Charles
1. **Calibrate the §3.4 defaults** to your real shop (consumables life, your power/gas, your CAD rate). This is the one thing that makes the defaults trustworthy.
2. Do you want **both** shop-rate modes in v1, or start with cost-build-up only and add income-goal later?
3. Should Pricing nudge appear automatically after ybr-5, or stay a passive sidebar tab the owner opens when ready?
```
