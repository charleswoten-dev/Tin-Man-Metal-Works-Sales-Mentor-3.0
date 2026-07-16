import { supabaseAdmin } from './supabaseAdmin.js';
import { generateUniqueLicenseKey } from './licenseKey.js';

// The ONE way to restore a buyer's access. Shared by the ClickFunnels webhooks
// (order.completed on a returning buyer, subscription.reactivated) and the admin
// panel's Reactivate button, so "let them back in" can't mean two different
// things — which it did: the admin route used to only flip `active`, leaving the
// buyer's license revoked and, since access became entitlement-checked per
// request, silently locked out despite the UI reporting success.
//
// Deliberately only touches approved_buyers and licenses: a returning buyer's
// profile, projects and chat history must survive the lapse and be waiting for
// them exactly as they left it. Nothing here wipes or re-creates user data.
//
// Idempotent: when they're already active with a usable key it writes nothing
// and reports changed:false.
//
// Returns { found, changed, licenseKey, used } — `used:false` means they never
// activated an account and still need their key in hand.
export async function reactivateBuyer({ email, orderId }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { found: false };

  const { data: buyer, error: buyerErr } = await supabaseAdmin
    .from('approved_buyers')
    .select('id, active, license_key')
    .eq('email', normalized)
    .maybeSingle();
  if (buyerErr) throw buyerErr;
  if (!buyer) return { found: false };

  const { data: licenses, error: licErr } = await supabaseAdmin
    .from('licenses')
    .select('id, key, revoked, used, created_at')
    .eq('email', normalized)
    .order('created_at', { ascending: false });
  if (licErr) throw licErr;

  // Restore the key they actually sign in with: the one they ACTIVATED, if any.
  // Picking merely the newest would grab a spare key an admin issued later —
  // that would re-point approved_buyers.license_key at the wrong key and email a
  // "here's your license" to someone who's had an account for months. Only that
  // one key is un-revoked, so a key revoked on purpose (e.g. leaked) is not
  // silently resurrected alongside it.
  const primary = licenses?.find((l) => l.used) || licenses?.[0] || null;

  if (buyer.active && primary && !primary.revoked) {
    return { found: true, changed: false, licenseKey: primary.key, used: primary.used };
  }

  let licenseKey = primary?.key || null;
  let used = primary?.used ?? false;

  if (!primary) {
    // Anomaly: an approved buyer with no key at all. Issue a fresh one so they
    // have something to register with.
    licenseKey = await generateUniqueLicenseKey();
    used = false;
    const { error } = await supabaseAdmin
      .from('licenses')
      .insert({ key: licenseKey, email: normalized, order_id: orderId, used: false });
    if (error) throw error;
  } else if (primary.revoked) {
    const { error } = await supabaseAdmin
      .from('licenses')
      .update({ revoked: false, revoked_at: null })
      .eq('id', primary.id);
    if (error) throw error;
  }

  const patch = { active: true };
  // Only re-point the buyer's key when we actually minted a new one.
  if (!primary && licenseKey) patch.license_key = licenseKey;
  if (orderId) patch.order_id = orderId;
  const { error: updErr } = await supabaseAdmin
    .from('approved_buyers')
    .update(patch)
    .eq('id', buyer.id);
  if (updErr) throw updErr;

  return { found: true, changed: true, licenseKey, used };
}
