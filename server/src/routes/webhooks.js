import { Router } from 'express';
import crypto from 'node:crypto';
import express from 'express';
import { supabaseAdmin, isAdminConfigured } from '../lib/supabaseAdmin.js';
import { generateUniqueLicenseKey } from '../lib/licenseKey.js';
import { sendWelcomeEmail } from '../lib/email.js';

const router = Router();

const SECRET = process.env.CLICKFUNNELS_WEBHOOK_SECRET;
const SECRET_PLACEHOLDER = 'PASTE_A_STRONG_RANDOM_WEBHOOK_SECRET_HERE';
const secretConfigured = Boolean(SECRET && SECRET !== SECRET_PLACEHOLDER);

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
function verifySignature(rawBuffer, headerValue, timestampValue) {
  if (!headerValue) return false;
  const provided = String(headerValue).replace(/^sha256=/i, '').trim();

  // Preferred: ClickFunnels 2.0 timestamp-prefixed scheme.
  if (timestampValue) {
    const ts = String(timestampValue).trim();
    const tsNum = Number(ts);
    // Reject stale/garbage timestamps (replay protection).
    if (Number.isFinite(tsNum)) {
      const ageSeconds = Math.abs(Date.now() / 1000 - tsNum);
      if (ageSeconds <= TIMESTAMP_TOLERANCE_SECONDS) {
        const signedPayload = Buffer.concat([
          Buffer.from(`${ts}.`, 'utf8'),
          rawBuffer,
        ]);
        const expected = crypto.createHmac('sha256', SECRET).update(signedPayload).digest('hex');
        if (safeEqualHex(provided, expected)) return true;
      }
    }
  }

  // Fallback: signature over the raw body only (relays/proxies, legacy senders).
  const expectedRaw = crypto.createHmac('sha256', SECRET).update(rawBuffer).digest('hex');
  return safeEqualHex(provided, expectedRaw);
}

// ClickFunnels payload shapes vary; pull the fields we need from common spots.
// ClickFunnels 2.0 wraps the subject (order/contact) under `data`, so we look
// there as well as at the top level and inside purchase/order/customer objects.
function extractFields(body) {
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

// POST /api/webhooks/clickfunnels  — raw body so we can verify the signature.
router.post('/clickfunnels', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  // Misconfiguration: cannot verify, so we must reject (never trust unverified).
  if (!secretConfigured) {
    console.error('[webhook] CLICKFUNNELS_WEBHOOK_SECRET not configured — rejecting.');
    await logWebhook({ status: 'rejected', detail: 'webhook secret not configured' });
    return res.status(503).json({ error: 'Webhook not configured.' });
  }
  if (!isAdminConfigured) {
    await logWebhook({ status: 'failed', detail: 'service role key not configured' });
    return res.status(503).json({ error: 'Server not configured.' });
  }

  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  // 1. Verify the signature on every request; reject anything unverified.
  const sigHeader = SIGNATURE_HEADERS.map((h) => req.headers[h]).find(Boolean);
  const tsHeader = TIMESTAMP_HEADERS.map((h) => req.headers[h]).find(Boolean);
  if (!verifySignature(rawBuffer, sigHeader, tsHeader)) {
    await logWebhook({ status: 'rejected', detail: 'invalid or missing signature' });
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  // 2. Parse the JSON body.
  let payload;
  try {
    payload = JSON.parse(rawBuffer.toString('utf8') || '{}');
  } catch {
    await logWebhook({ status: 'failed', detail: 'invalid JSON body' });
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  const { email, orderId, firstName } = extractFields(payload);
  if (!email) {
    await logWebhook({ orderId, status: 'failed', detail: 'no email in payload' });
    return res.status(400).json({ error: 'Missing buyer email.' });
  }

  try {
    // 3. Already approved? Idempotent — skip (handles webhook retries/dupes).
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('approved_buyers')
      .select('id, license_key')
      .eq('email', email)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) {
      await logWebhook({ email, orderId, status: 'skipped', detail: 'email already approved' });
      return res.status(200).json({ ok: true, skipped: true });
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

export default router;
