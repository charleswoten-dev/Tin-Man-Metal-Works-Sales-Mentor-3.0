import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin, isAdminConfigured } from '../lib/supabaseAdmin.js';
import {
  requireAdmin,
  verifyAdminCredentials,
  signAdminToken,
  isAdminAuthConfigured,
} from '../lib/adminAuth.js';
import { generateUniqueLicenseKey } from '../lib/licenseKey.js';
import { sendWelcomeEmail } from '../lib/email.js';
import { reactivateBuyer } from '../lib/reactivate.js';

const router = Router();

// Throttle login to blunt brute-force attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(','));
  return [header, ...lines].join('\n');
}

// ── Auth ──────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  if (!isAdminAuthConfigured) return res.status(503).json({ error: 'Admin not configured.' });
  const { email, password } = req.body || {};
  try {
    const admin = await verifyAdminCredentials(email, password);
    if (!admin) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = signAdminToken(admin);
    return res.status(200).json({ token, email: admin.email });
  } catch (err) {
    console.error('[admin] login error:', err?.message || err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Everything below requires a valid admin session.
router.use(requireAdmin);

// Lightweight token check used by the client to validate a stored session.
router.get('/me', (req, res) => res.json({ email: req.admin.email }));

// ── Dashboard stats ─────────────────────────────────────────────────────────
async function countWhere(table, build) {
  let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 864e5).toISOString();

    const [
      totalLicenses,
      activatedLicenses,
      revokedLicenses,
      pendingLicenses,
      activeUsers,
      purchasesToday,
      purchasesWeek,
      purchasesMonth,
    ] = await Promise.all([
      countWhere('licenses'),
      countWhere('licenses', (q) => q.eq('used', true)),
      countWhere('licenses', (q) => q.eq('revoked', true)),
      countWhere('licenses', (q) => q.eq('used', false).eq('revoked', false)),
      countWhere('profiles'),
      countWhere('approved_buyers', (q) => q.gte('purchase_date', startOfDay)),
      countWhere('approved_buyers', (q) => q.gte('purchase_date', weekAgo)),
      countWhere('approved_buyers', (q) => q.gte('purchase_date', monthAgo)),
    ]);

    return res.json({
      licenses: {
        total: totalLicenses,
        activated: activatedLicenses,
        pending: pendingLicenses,
        revoked: revokedLicenses,
      },
      activeUsers,
      purchases: { today: purchasesToday, week: purchasesWeek, month: purchasesMonth },
    });
  } catch (err) {
    console.error('[admin] stats error:', err?.message || err);
    return res.status(500).json({ error: 'Could not load stats.' });
  }
});

// ── Licenses ────────────────────────────────────────────────────────────────
function applyLicenseFilters(q, { search, status }) {
  if (search) q = q.or(`key.ilike.%${search}%,email.ilike.%${search}%,order_id.ilike.%${search}%`);
  if (status === 'activated') q = q.eq('used', true).eq('revoked', false);
  else if (status === 'pending') q = q.eq('used', false).eq('revoked', false);
  else if (status === 'revoked') q = q.eq('revoked', true);
  return q;
}

router.get('/licenses', async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  const status = (req.query.status || 'all').toString();
  try {
    let q = supabaseAdmin
      .from('licenses')
      .select('id, key, email, used, used_at, revoked, revoked_at, order_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    q = applyLicenseFilters(q, { search, status });
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ licenses: data || [] });
  } catch (err) {
    console.error('[admin] licenses list error:', err?.message || err);
    return res.status(500).json({ error: 'Could not load licenses.' });
  }
});

router.get('/licenses/export', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('licenses')
      .select('key, email, used, used_at, revoked, revoked_at, order_id, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const csv = toCsv(data || [], [
      { key: 'key', label: 'License Key' },
      { key: 'email', label: 'Email' },
      { key: 'used', label: 'Used' },
      { key: 'used_at', label: 'Used At' },
      { key: 'revoked', label: 'Revoked' },
      { key: 'revoked_at', label: 'Revoked At' },
      { key: 'order_id', label: 'Order ID' },
      { key: 'created_at', label: 'Created At' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="licenses.csv"');
    return res.send(csv);
  } catch (err) {
    console.error('[admin] licenses export error:', err?.message || err);
    return res.status(500).json({ error: 'Could not export licenses.' });
  }
});

router.post('/licenses/generate', async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 1, 1), 100);
  const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
  const autoEmail = Boolean(req.body?.autoEmail);
  try {
    const created = [];
    for (let i = 0; i < count; i++) {
      const key = await generateUniqueLicenseKey();
      const { error } = await supabaseAdmin
        .from('licenses')
        .insert({ key, email, used: false });
      if (error) throw error;
      created.push(key);
    }

    // If bound to an email, make sure that email can actually register.
    if (email) {
      await supabaseAdmin
        .from('approved_buyers')
        .upsert(
          {
            email,
            license_key: created[0],
            purchase_date: new Date().toISOString(),
            active: true,
          },
          { onConflict: 'email' }
        );
    }

    let emailed = false;
    if (autoEmail && email) {
      try {
        await sendWelcomeEmail({ email, firstName: '', licenseKey: created[0] });
        emailed = true;
      } catch (mailErr) {
        console.error('[admin] generate auto-email failed:', mailErr?.message || mailErr);
      }
    }

    return res.json({ ok: true, keys: created, emailed });
  } catch (err) {
    console.error('[admin] generate error:', err?.message || err);
    return res.status(500).json({ error: 'Could not generate licenses.' });
  }
});

router.post('/licenses/:id/revoke', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('licenses')
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] revoke error:', err?.message || err);
    return res.status(500).json({ error: 'Could not revoke license.' });
  }
});

router.post('/licenses/:id/reinstate', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('licenses')
      .update({ revoked: false, revoked_at: null })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] reinstate error:', err?.message || err);
    return res.status(500).json({ error: 'Could not reinstate license.' });
  }
});

// ── Approved buyers ───────────────────────────────────────────────────────────
router.get('/buyers', async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  try {
    let q = supabaseAdmin
      .from('approved_buyers')
      .select('id, email, purchase_date, order_id, license_key, active, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (search) q = q.or(`email.ilike.%${search}%,order_id.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ buyers: data || [] });
  } catch (err) {
    console.error('[admin] buyers list error:', err?.message || err);
    return res.status(500).json({ error: 'Could not load buyers.' });
  }
});

router.post('/buyers', async (req, res) => {
  const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
  const orderId = req.body?.orderId ? String(req.body.orderId) : null;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const { error } = await supabaseAdmin.from('approved_buyers').upsert(
      {
        email,
        order_id: orderId,
        purchase_date: new Date().toISOString(),
        active: true,
      },
      { onConflict: 'email' }
    );
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] add buyer error:', err?.message || err);
    return res.status(500).json({ error: 'Could not add buyer.' });
  }
});

router.post('/buyers/import', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
  try {
    const payload = rows
      .map((r) => ({
        email: r.email ? String(r.email).trim().toLowerCase() : null,
        order_id: r.order_id ? String(r.order_id) : null,
        purchase_date: new Date().toISOString(),
        active: true,
      }))
      .filter((r) => r.email);
    if (!payload.length) return res.status(400).json({ error: 'No valid emails found.' });
    const { error } = await supabaseAdmin
      .from('approved_buyers')
      .upsert(payload, { onConflict: 'email' });
    if (error) throw error;
    return res.json({ ok: true, imported: payload.length });
  } catch (err) {
    console.error('[admin] import buyers error:', err?.message || err);
    return res.status(500).json({ error: 'Could not import buyers.' });
  }
});

router.post('/buyers/:id/deactivate', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('approved_buyers')
      .update({ active: false })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] deactivate buyer error:', err?.message || err);
    return res.status(500).json({ error: 'Could not deactivate buyer.' });
  }
});

// Restore a buyer's access. Uses the same helper as the ClickFunnels webhooks,
// because flipping `active` alone is NOT enough: revoking (here or on churn)
// also revokes their license, and access is entitlement-checked per request —
// so an active buyer with only revoked licenses stays locked out. This button
// used to do exactly that and report success.
router.post('/buyers/:id/reactivate', async (req, res) => {
  try {
    const { data: buyer, error: findErr } = await supabaseAdmin
      .from('approved_buyers')
      .select('email')
      .eq('id', req.params.id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!buyer?.email) return res.status(404).json({ error: 'Buyer not found.' });

    const result = await reactivateBuyer({ email: buyer.email });
    if (!result.found) return res.status(404).json({ error: 'Buyer not found.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] reactivate buyer error:', err?.message || err);
    return res.status(500).json({ error: 'Could not reactivate buyer.' });
  }
});

// ── Active users ──────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, niche, license_key, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    // Conversation count = user-role messages, fetched per user (admin scale).
    const users = await Promise.all(
      (profiles || []).map(async (p) => {
        const { count } = await supabaseAdmin
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', p.id)
          .eq('role', 'user');
        return {
          id: p.id,
          email: p.email,
          name: p.name,
          niche: p.niche,
          licenseKey: p.license_key,
          activatedAt: p.created_at,
          lastActive: p.updated_at,
          conversationCount: count || 0,
        };
      })
    );
    return res.json({ users });
  } catch (err) {
    console.error('[admin] users error:', err?.message || err);
    return res.status(500).json({ error: 'Could not load users.' });
  }
});

// Revoke a user: deactivate their buyer record + revoke their license. (We do
// not delete the auth account here — that's a heavier, separate action.)
router.post('/users/:id/revoke', async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('email, license_key')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (profile?.email) {
      await supabaseAdmin
        .from('approved_buyers')
        .update({ active: false })
        .eq('email', profile.email);
    }
    if (profile?.license_key) {
      await supabaseAdmin
        .from('licenses')
        .update({ revoked: true, revoked_at: new Date().toISOString() })
        .eq('key', profile.license_key);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] user revoke error:', err?.message || err);
    return res.status(500).json({ error: 'Could not revoke user.' });
  }
});

// ── Webhook logs ──────────────────────────────────────────────────────────────
router.get('/webhook-logs', async (req, res) => {
  const status = (req.query.status || 'all').toString();
  try {
    let q = supabaseAdmin
      .from('webhook_logs')
      .select('id, source, email, order_id, status, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ logs: data || [] });
  } catch (err) {
    console.error('[admin] webhook logs error:', err?.message || err);
    return res.status(500).json({ error: 'Could not load webhook logs.' });
  }
});

// ── Email resend ──────────────────────────────────────────────────────────────
router.post('/resend-email', async (req, res) => {
  const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const { data: buyer, error } = await supabaseAdmin
      .from('approved_buyers')
      .select('email, license_key')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (!buyer || !buyer.license_key) {
      return res.status(404).json({ error: 'No buyer/license found for that email.' });
    }
    const result = await sendWelcomeEmail({
      email: buyer.email,
      firstName: '',
      licenseKey: buyer.license_key,
    });
    return res.json({ ok: true, stub: Boolean(result?.stub) });
  } catch (err) {
    console.error('[admin] resend email error:', err?.message || err);
    return res.status(500).json({ error: 'Could not resend email.' });
  }
});

export default router;
