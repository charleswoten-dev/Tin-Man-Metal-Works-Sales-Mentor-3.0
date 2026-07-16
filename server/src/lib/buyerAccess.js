import { supabaseAdmin, isAdminConfigured } from './supabaseAdmin.js';

// Per-request entitlement checking.
//
// The registration gate (routes/register.js) only runs once, when the account is
// created. Supabase sessions are long-lived and auto-refresh, so without a
// per-request check a buyer whose subscription churned would keep full access
// until they next signed in — which may be never. This module lets the API
// confirm, on every request, that the caller is still an active, non-revoked
// buyer, so a revocation lands on their very next request.

// Sent to the client when a real, authenticated user is no longer entitled, so
// the UI can tell "your access ended" apart from "your session expired".
export const ACCESS_REVOKED = 'ACCESS_REVOKED';

// Is this email still entitled to use the Mentor?
//
// Entitled = an approved_buyers row that is active AND, if they have any license
// rows at all, at least one that isn't revoked. A buyer with no license row is
// judged on `active` alone: provisioning always writes a license, so a missing
// one is a data anomaly, and locking a paying customer out over it would be a
// worse failure than letting them through on the `active` flag.
export async function isActiveBuyer(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'no email' };

  const { data: buyer, error: buyerErr } = await supabaseAdmin
    .from('approved_buyers')
    .select('active')
    .eq('email', normalized)
    .maybeSingle();
  if (buyerErr) throw buyerErr;
  if (!buyer) return { ok: false, reason: 'not an approved buyer' };
  if (!buyer.active) return { ok: false, reason: 'buyer inactive' };

  const { data: licenses, error: licErr } = await supabaseAdmin
    .from('licenses')
    .select('revoked')
    .eq('email', normalized);
  if (licErr) throw licErr;
  if (licenses?.length && !licenses.some((l) => !l.revoked)) {
    return { ok: false, reason: 'all licenses revoked' };
  }

  return { ok: true };
}

// Express middleware — gate an API route behind "a signed-in, still-entitled
// buyer". Verifies the caller's Supabase access token, resolves it to an email,
// then checks entitlement.
//
// Fails CLOSED: if the token can't be verified the request is rejected, and if
// the entitlement lookup itself errors we return 503 (a retryable "try again")
// rather than assuming the caller is entitled.
export async function requireActiveBuyer(req, res, next) {
  if (!isAdminConfigured) {
    return res.status(503).json({ error: 'Server not configured.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Please sign in to keep working with the Tin Man.' });
  }

  let email;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.email) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    email = data.user.email;
  } catch (err) {
    console.error('[access] token verification failed:', err?.message || err);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  try {
    const verdict = await isActiveBuyer(email);
    if (!verdict.ok) {
      console.warn(`[access] denied for ${email}: ${verdict.reason}`);
      return res.status(403).json({
        error:
          'Your Tin Man access isn’t active right now. If you think this is a mistake, contact support and we’ll get you back in.',
        code: ACCESS_REVOKED,
      });
    }
  } catch (err) {
    console.error('[access] entitlement check failed:', err?.message || err);
    return res.status(503).json({ error: 'Could not verify your access right now. Please try again.' });
  }

  req.buyer = { email: String(email).trim().toLowerCase() };
  return next();
}
