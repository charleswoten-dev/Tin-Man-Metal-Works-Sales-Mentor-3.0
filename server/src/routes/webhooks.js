import { Router } from 'express';
import crypto from 'node:crypto';
import express from 'express';
import { supabaseAdmin, isAdminConfigured } from '../lib/supabaseAdmin.js';
import { generateUniqueLicenseKey } from '../lib/licenseKey.js';
import { sendWelcomeEmail } from '../lib/email.js';

const router = Router();

// ClickFunnels signs each endpoint with its OWN secret, and we have three
// (provision, cancel, reactivate). So CLICKFUNNELS_WEBHOOK_SECRET is read as a
// comma-separated LIST and a signature is accepted if it matches ANY of them —
// one env var covers every endpoint, and rotating one secret can't break the
// others. A single secret is just a one-item list, so existing setups are
// unaffected.
const SECRET_PLACEHOLDER = 'PASTE_A_STRONG_RANDOM_WEBHOOK_SECRET_HERE';
const SECRETS = String(process.env.CLICKFUNNELS_WEBHOOK_SECRET || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && s !== SECRET_PLACEHOLDER);
const secretConfigured = SECRETS.length > 0;

// Headers ClickFunnels (or a proxy) might use to carry the HMAC signature.
// ClickFunnels 2.0's account-level outgoing webhooks send the first one; the
// rest are kept as fallbacks for proxies/relays or other senders.
const SIGNATURE_HEADERS = [
  'x-webhook-clickfunnels-signature',
  'x-clickfunnels-signature',
  'x-cf-signature',
  'x-webhook-signature',
  'x-signature',
];

// ClickFunnels 2.0 sends the request timestamp here and signs "{timestamp}.{body}".
const TIMESTAMP_HEADERS = [
  'x-webhook-clickfunnels-timestamp',
  'x-clickfunnels-timestamp',
  'x-webhook-timestamp',
];

// Reject signatures whose timestamp is older than this (replay protection).
// Matches ClickFunnels' default 600s window.
const TIMESTAMP_TOLERANCE_SECONDS = 600;

// Write an audit row for every webhook attempt. Never throws — logging must not
// break webhook processing.
async function logWebhook({ email, orderId, status, detail }) {
  try {
    await supabaseAdmin.from('webhook_logs').insert({
      source: 'clickfunnels',
      email: email || null,
      order_id: orderId || null,
      status,
      detail: detail ? String(detail).slice(0, 500) : null,
    });
  } catch (err) {
    console.error('[webhook] failed to write webhook_log:', err?.message || err);
  }
}

// Constant-time hex-digest comparison.
function safeEqualHex(provided, expected) {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Verify the request signature.
//
// ClickFunnels 2.0 signs HMAC-SHA256 over "{timestamp}.{raw_body}" and sends the
// digest in X-Webhook-ClickFunnels-Signature with the timestamp in
// X-Webhook-ClickFunnels-Timestamp. We verify that scheme first (including a
// freshness check to block replays). As a fallback — for relays/proxies or other
// senders that sign just the raw body — we also accept HMAC-SHA256(raw_body).
export function verifySignature(rawBuffer, headerValue, timestampValue) {
  if (!headerValue) return false;
  const provided = String(headerValue).replace(/^sha256=/i, '').trim();

  // Preferred: ClickFunnels 2.0 timestamp-prefixed scheme. The signed payload is
  // the same for every secret, so build it once — and only when the timestamp is
  // present and fresh, which is what blocks replays.
  let signedPayload = null;
  if (timestampValue) {
    const ts = String(timestampValue).trim();
    const tsNum = Number(ts);
    // Reject stale/garbage timestamps (replay protection).
    if (Number.isFinite(tsNum)) {
      const ageSeconds = Math.abs(Date.now() / 1000 - tsNum);
      if (ageSeconds <= TIMESTAMP_TOLERANCE_SECONDS) {
        signedPayload = Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), rawBuffer]);
      }
    }
  }

  // Accept if ANY configured secret validates under either scheme: the request
  // doesn't say which endpoint's secret signed it, so each is tried in turn.
  for (const secret of SECRETS) {
    if (signedPayload) {
      const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      if (safeEqualHex(provided, expected)) return true;
    }
    // Fallback: signature over the raw body only (relays/proxies, legacy senders).
    const expectedRaw = crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
    if (safeEqualHex(provided, expectedRaw)) return true;
  }
  return false;
}

// ClickFunnels payload shapes vary; pull the fields we need from common spots.
// ClickFunnels 2.0 wraps the subject (order/contact) under `data`, so we look
// there as well as at the top level and inside purchase/order/customer objects.
export function extractFields(body) {
  const b = body || {};
  const data = b.data || {};
  // Where the buyer's details might live, in priority order.
  const contact =
    b.contact ||
    b.purchase?.contact ||
    data.contact ||
    data.customer ||
    data.order?.contact ||
    data.order?.customer ||
    {};
  const email =
    b.email ||
    contact.email ||
    contact.email_address ||
    b.purchase?.email ||
    data.email ||
    data.customer?.email ||
    data.order?.email ||
    b.contact_email ||
    null;
  const orderId =
    b.order_id ||
    b.id ||
    b.purchase?.id ||
    b.order?.id ||
    data.id ||
    data.order?.id ||
    data.order_id ||
    b.purchase_id ||
    null;
  const firstName =
    b.first_name ||
    contact.first_name ||
    data.first_name ||
    (b.name || contact.name || data.name || '').toString().trim().split(/\s+/)[0] ||
    '';
  return {
    email: email ? String(email).trim().toLowerCase() : null,
    orderId: orderId ? String(orderId) : null,
    firstName,
  };
}

// Shared front door for every ClickFunnels webhook: reject if we can't verify,
// check the signature, parse the JSON, and pull out the buyer's details. Keeps
// all three endpoints on identical, signature-verified, logged handling.
//
// Returns the extracted fields, or null when it has already responded — callers
// must `if (!received) return;`.
async function receive(req, res, tag) {
  // Misconfiguration: cannot verify, so we must reject (never trust unverified).
  if (!secretConfigured) {
    console.error(`[webhook:${tag}] CLICKFUNNELS_WEBHOOK_SECRET not configured — rejecting.`);
    await logWebhook({ status: 'rejected', detail: `${tag}: webhook secret not configured` });
    res.status(503).json({ error: 'Webhook not configured.' });
    return null;
  }
  if (!isAdminConfigured) {
    await logWebhook({ status: 'failed', detail: `${tag}: service role key not configured` });
    res.status(503).json({ error: 'Server not configured.' });
    return null;
  }

  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  // Verify the signature on every request; reject anything unverified.
  const sigHeader = SIGNATURE_HEADERS.map((h) => req.headers[h]).find(Boolean);
  const tsHeader = TIMESTAMP_HEADERS.map((h) => req.headers[h]).find(Boolean);
  if (!verifySignature(rawBuffer, sigHeader, tsHeader)) {
    await logWebhook({ status: 'rejected', detail: `${tag}: invalid or missing signature` });
    res.status(401).json({ error: 'Invalid signature.' });
    return null;
  }

  // Parse the JSON body.
  let payload;
  try {
    payload = JSON.parse(rawBuffer.toString('utf8') || '{}');
  } catch {
    await logWebhook({ status: 'failed', detail: `${tag}: invalid JSON body` });
    res.status(400).json({ error: 'Invalid JSON.' });
    return null;
  }

  const fields = extractFields(payload);
  if (!fields.email) {
    await logWebhook({ orderId: fields.orderId, status: 'failed', detail: `${tag}: no email in payload` });
    res.status(400).json({ error: 'Missing buyer email.' });
    return null;
  }
  return fields;
}

// Restore access for a buyer who already exists — a returning buyer whose plan
// churned and came back, or simply a retried/duplicate event.
//
// Deliberately only touches approved_buyers and licenses: a returning buyer's
// profile, projects and chat history must survive the lapse and be waiting for
// them exactly as they left it. Nothing here wipes or re-creates user data.
//
// Idempotent: when they're already active with a usable key it writes nothing
// and reports changed:false.
async function reactivateBuyer({ email, orderId }) {
  const { data: buyer, error: buyerErr } = await supabaseAdmin
    .from('approved_buyers')
    .select('id, active, license_key')
    .eq('email', email)
    .maybeSingle();
  if (buyerErr) throw buyerErr;
  if (!buyer) return { found: false };

  // Their newest key is the one they'd activate with (or already have).
  const { data: licenses, error: licErr } = await supabaseAdmin
    .from('licenses')
    .select('id, key, revoked, used')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1);
  if (licErr) throw licErr;
  const license = licenses?.[0] || null;

  if (buyer.active && license && !license.revoked) {
    return { found: true, changed: false, licenseKey: license.key, used: license.used };
  }

  let licenseKey = license?.key || null;
  let used = license?.used ?? false;

  if (!license) {
    // Anomaly: an approved buyer with no key at all. Issue a fresh one so they
    // have something to register with.
    licenseKey = await generateUniqueLicenseKey();
    used = false;
    const { error } = await supabaseAdmin
      .from('licenses')
      .insert({ key: licenseKey, email, order_id: orderId, used: false });
    if (error) throw error;
  } else if (license.revoked) {
    const { error } = await supabaseAdmin
      .from('licenses')
      .update({ revoked: false, revoked_at: null })
      .eq('id', license.id);
    if (error) throw error;
  }

  const patch = { active: true };
  if (licenseKey && licenseKey !== buyer.license_key) patch.license_key = licenseKey;
  if (orderId) patch.order_id = orderId;
  const { error: updErr } = await supabaseAdmin.from('approved_buyers').update(patch).eq('id', buyer.id);
  if (updErr) throw updErr;

  return { found: true, changed: true, licenseKey, used };
}

// A reactivated buyer who never got as far as activating their account still
// needs their key in hand; one who already activated just signs in as before.
async function emailKeyIfNeverActivated({ email, firstName, licenseKey, used }) {
  if (used || !licenseKey) return '';
  try {
    const result = await sendWelcomeEmail({ email, firstName, licenseKey });
    return result?.stub ? '; welcome email stubbed' : '; welcome email re-sent';
  } catch (mailErr) {
    console.error('[webhook] welcome email failed:', mailErr?.message || mailErr);
    return `; welcome email failed: ${mailErr?.message || mailErr}`;
  }
}

// POST /api/webhooks/clickfunnels  — raw body so we can verify the signature.
// Fired by order.completed / one-time-order.completed: provisions a new buyer,
// or reactivates a returning one.
router.post('/clickfunnels', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const received = await receive(req, res, 'order');
  if (!received) return;
  const { email, orderId, firstName } = received;

  try {
    // 3. Already known? Then this is either a retry/duplicate (no-op) or a
    //    returning buyer coming back after a cancellation — in which case
    //    restore their access instead of skipping, so they pick up exactly
    //    where they left off. Their profile and projects are never touched.
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('approved_buyers')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) {
      const restored = await reactivateBuyer({ email, orderId });
      if (!restored.changed) {
        await logWebhook({ email, orderId, status: 'skipped', detail: 'email already approved and active' });
        return res.status(200).json({ ok: true, skipped: true });
      }
      const mailDetail = await emailKeyIfNeverActivated({
        email,
        firstName,
        licenseKey: restored.licenseKey,
        used: restored.used,
      });
      await logWebhook({
        email,
        orderId,
        status: 'success',
        detail: `returning buyer reactivated; existing profile and projects preserved${mailDetail}`,
      });
      return res.status(200).json({ ok: true, reactivated: true });
    }

    // 4. Generate a unique license key.
    const key = await generateUniqueLicenseKey();
    const now = new Date().toISOString();

    // 5. Insert the license.
    const { error: licErr } = await supabaseAdmin.from('licenses').insert({
      key,
      email,
      order_id: orderId,
      used: false,
    });
    if (licErr) throw licErr;

    // 6. Add to approved_buyers.
    const { error: buyerErr } = await supabaseAdmin.from('approved_buyers').insert({
      email,
      purchase_date: now,
      order_id: orderId,
      license_key: key,
      active: true,
    });
    if (buyerErr) throw buyerErr;

    // 7. Send the welcome email (failure logged but does not fail the webhook —
    //    the buyer is already provisioned and the email can be resent from admin).
    let emailDetail = 'email sent';
    try {
      const result = await sendWelcomeEmail({ email, firstName, licenseKey: key });
      if (result?.stub) emailDetail = 'email stubbed (Step 3 pending)';
    } catch (mailErr) {
      emailDetail = `email send failed: ${mailErr?.message || mailErr}`;
      console.error('[webhook] welcome email failed:', mailErr?.message || mailErr);
    }

    // 8. Log success.
    await logWebhook({ email, orderId, status: 'success', detail: emailDetail });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] processing error:', err?.message || err);
    await logWebhook({ email, orderId, status: 'failed', detail: err?.message || 'processing error' });
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// POST /api/webhooks/clickfunnels-cancel  — revoke access when a ClickFunnels
// subscription/payment-plan is cancelled or churns. Mirrors the provisioning
// route above (same HMAC verification), but instead of granting a license it
// deactivates the buyer and revokes their license key(s) for the given email.
// Idempotent: re-sending the same cancel event is a harmless no-op.
router.post('/clickfunnels-cancel', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const received = await receive(req, res, 'cancel');
  if (!received) return;
  const { email, orderId } = received;

  try {
    const nowIso = new Date().toISOString();

    // 3. Deactivate the buyer so they can no longer register/log in — and, via
    //    the per-request check in lib/buyerAccess.js, so any session they
    //    already have stops working on its next request.
    const { error: buyerErr } = await supabaseAdmin
      .from('approved_buyers')
      .update({ active: false })
      .eq('email', email);
    if (buyerErr) throw buyerErr;

    // 4. Revoke any of their license keys that aren't already revoked.
    const { error: licErr } = await supabaseAdmin
      .from('licenses')
      .update({ revoked: true, revoked_at: nowIso })
      .eq('email', email)
      .eq('revoked', false);
    if (licErr) throw licErr;

    // 5. Log success.
    await logWebhook({ email, orderId, status: 'success', detail: 'access revoked (subscription cancelled/churned)' });
    return res.status(200).json({ ok: true, revoked: true });
  } catch (err) {
    console.error('[webhook:cancel] processing error:', err?.message || err);
    await logWebhook({ email, orderId, status: 'failed', detail: `cancel: ${err?.message || 'processing error'}` });
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// POST /api/webhooks/clickfunnels-reactivate  — restore access when a churned
// ClickFunnels subscription is reactivated. The mirror image of the cancel route
// above: same HMAC verification, same logging, opposite effect. Their existing
// profile, projects and chat history are left untouched, so a returning buyer
// resumes exactly where they left off.
// Idempotent: re-sending the same reactivate event is a harmless no-op.
router.post('/clickfunnels-reactivate', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const received = await receive(req, res, 'reactivate');
  if (!received) return;
  const { email, orderId, firstName } = received;

  try {
    const restored = await reactivateBuyer({ email, orderId });

    // Not a buyer we've ever provisioned — nothing to restore. Reported as a
    // no-op rather than an error so ClickFunnels doesn't retry forever.
    if (!restored.found) {
      await logWebhook({ email, orderId, status: 'skipped', detail: 'reactivate: no approved_buyer for this email' });
      return res.status(200).json({ ok: true, skipped: true });
    }
    if (!restored.changed) {
      await logWebhook({ email, orderId, status: 'skipped', detail: 'reactivate: already active' });
      return res.status(200).json({ ok: true, skipped: true });
    }

    const mailDetail = await emailKeyIfNeverActivated({
      email,
      firstName,
      licenseKey: restored.licenseKey,
      used: restored.used,
    });
    await logWebhook({
      email,
      orderId,
      status: 'success',
      detail: `access restored (subscription reactivated); existing profile and projects preserved${mailDetail}`,
    });
    return res.status(200).json({ ok: true, reactivated: true });
  } catch (err) {
    console.error('[webhook:reactivate] processing error:', err?.message || err);
    await logWebhook({ email, orderId, status: 'failed', detail: `reactivate: ${err?.message || 'processing error'}` });
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

export default router;
