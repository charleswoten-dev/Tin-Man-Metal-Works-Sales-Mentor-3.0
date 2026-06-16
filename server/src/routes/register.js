import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin, isAdminConfigured } from '../lib/supabaseAdmin.js';
import { looksLikeLicenseKey } from '../lib/licenseKey.js';

const router = Router();

// SECURITY: never reveal WHY validation failed beyond a single friendly message.
// The client shows warm copy; the API only ever says ok/valid true|false so an
// attacker can't probe which emails or keys exist.
const GENERIC_REJECTION = { ok: true, valid: false };

// Rate limit per IP across all registration endpoints. A single legitimate
// activation makes 3 calls (check-email + validate-key + activate), so the cap
// is set well above that to tolerate a few mistyped-key retries without locking
// out a real buyer — while staying far too low for brute-forcing the key space.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
router.use(registrationLimiter);

// Audit every failed registration attempt. Never throws.
async function logAttempt({ email, status, detail }) {
  try {
    await supabaseAdmin.from('webhook_logs').insert({
      source: 'registration',
      email: email || null,
      status,
      detail: detail ? String(detail).slice(0, 500) : null,
    });
  } catch (err) {
    console.error('[register] failed to write log:', err?.message || err);
  }
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : '';
}

function normalizeKey(value) {
  return value ? String(value).trim().toUpperCase() : '';
}

// Step 1 — Email Check. Is this email an approved buyer with an active record?
router.post('/check-email', async (req, res) => {
  if (!isAdminConfigured) return res.status(503).json({ error: 'Server not configured.' });
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('approved_buyers')
      .select('id, active')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;

    const approved = Boolean(data && data.active);
    if (!approved) {
      await logAttempt({ email, status: 'rejected', detail: 'email not approved' });
    }
    return res.status(200).json({ ok: true, approved });
  } catch (err) {
    console.error('[register] check-email error:', err?.message || err);
    return res.status(500).json({ error: 'Could not verify access right now.' });
  }
});

// Step 3 — Key Validation. Valid only if the key exists, is not revoked, not
// used, and is bound to this email. Any failure returns the same generic shape.
router.post('/validate-key', async (req, res) => {
  if (!isAdminConfigured) return res.status(503).json({ error: 'Server not configured.' });
  const email = normalizeEmail(req.body?.email);
  const key = normalizeKey(req.body?.licenseKey);
  if (!email || !key) return res.status(400).json({ error: 'Email and license key are required.' });

  if (!looksLikeLicenseKey(key)) {
    await logAttempt({ email, status: 'rejected', detail: 'malformed key' });
    return res.status(200).json(GENERIC_REJECTION);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('licenses')
      .select('id, email, used, revoked')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;

    const valid =
      Boolean(data) && !data.revoked && !data.used && data.email === email;

    if (!valid) {
      const reason = !data
        ? 'key not found'
        : data.revoked
        ? 'key revoked'
        : data.used
        ? 'key already used'
        : 'email mismatch';
      await logAttempt({ email, status: 'rejected', detail: reason });
      return res.status(200).json(GENERIC_REJECTION);
    }

    return res.status(200).json({ ok: true, valid: true });
  } catch (err) {
    console.error('[register] validate-key error:', err?.message || err);
    return res.status(500).json({ error: 'Could not validate the key right now.' });
  }
});

// Step 4 — Account Creation. Re-validates the key server-side (never trust the
// client), creates the Supabase auth account, and permanently binds the key.
router.post('/activate', async (req, res) => {
  if (!isAdminConfigured) return res.status(503).json({ error: 'Server not configured.' });
  const email = normalizeEmail(req.body?.email);
  const key = normalizeKey(req.body?.licenseKey);
  const password = req.body?.password;

  if (!email || !key || !password) {
    return res.status(400).json({ error: 'Email, license key, and password are required.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!looksLikeLicenseKey(key)) {
    await logAttempt({ email, status: 'rejected', detail: 'activate: malformed key' });
    return res.status(400).json({ error: 'We couldn’t activate your account. Please check your details.' });
  }

  try {
    // Re-validate the key under the bound email.
    const { data: license, error: licErr } = await supabaseAdmin
      .from('licenses')
      .select('id, email, used, revoked')
      .eq('key', key)
      .maybeSingle();
    if (licErr) throw licErr;

    const valid =
      Boolean(license) && !license.revoked && !license.used && license.email === email;
    if (!valid) {
      await logAttempt({ email, status: 'rejected', detail: 'activate: key invalid at activation' });
      return res
        .status(400)
        .json({ error: 'We couldn’t activate your account. Please check your details.' });
    }

    // Create the auth account (email pre-confirmed — they bought it).
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) {
      const msg = String(createErr.message || '');
      // Account already exists — guide them to sign in rather than leaking detail.
      if (/already|registered|exists/i.test(msg)) {
        await logAttempt({ email, status: 'rejected', detail: 'activate: account already exists' });
        return res
          .status(409)
          .json({ error: 'An account with this email already exists. Please sign in.' });
      }
      throw createErr;
    }

    const now = new Date().toISOString();

    // Permanently bind the key: mark used. If this fails, clean up the auth user
    // so the key isn't silently consumed without an account.
    const { error: useErr } = await supabaseAdmin
      .from('licenses')
      .update({ used: true, used_at: now })
      .eq('id', license.id)
      .eq('used', false);
    if (useErr) {
      if (created?.user?.id) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
      }
      throw useErr;
    }

    // Best-effort: stamp the license key onto the profile row.
    if (created?.user?.id) {
      await supabaseAdmin
        .from('profiles')
        .upsert({ id: created.user.id, license_key: key }, { onConflict: 'id' })
        .then(({ error }) => {
          if (error) console.error('[register] profile license stamp failed:', error.message);
        });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[register] activate error:', err?.message || err);
    await logAttempt({ email, status: 'failed', detail: err?.message || 'activate error' });
    return res.status(500).json({ error: 'Account creation failed. Please try again.' });
  }
});

export default router;
