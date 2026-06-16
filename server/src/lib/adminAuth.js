import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabaseAdmin, isAdminConfigured } from './supabaseAdmin.js';

const JWT_PLACEHOLDER = 'PASTE_A_LONG_RANDOM_JWT_SECRET_HERE';
const PW_PLACEHOLDER = 'PASTE_A_STRONG_ADMIN_PASSWORD_HERE';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export const isAdminAuthConfigured = Boolean(
  JWT_SECRET && JWT_SECRET !== JWT_PLACEHOLDER && isAdminConfigured
);

const TOKEN_TTL = '12h';

export function signAdminToken(admin) {
  return jwt.sign({ email: admin.email, role: 'admin' }, JWT_SECRET, {
    subject: admin.id,
    expiresIn: TOKEN_TTL,
  });
}

export function verifyAdminToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function verifyAdminCredentials(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password) return null;

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, email, password_hash')
    .eq('email', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ok = await bcrypt.compare(String(password), data.password_hash);
  if (!ok) return null;
  return { id: data.id, email: data.email };
}

// Express middleware — gate every admin API route behind a valid admin JWT.
export function requireAdmin(req, res, next) {
  if (!isAdminAuthConfigured) {
    return res.status(503).json({ error: 'Admin not configured.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = verifyAdminToken(token);
    req.admin = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

// Seed the default admin from env on startup (idempotent). Logs but never throws
// so a seeding hiccup can't crash the server.
export async function seedDefaultAdmin() {
  if (!isAdminConfigured) return;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD === PW_PLACEHOLDER) {
    console.warn('[admin] ADMIN_EMAIL/ADMIN_PASSWORD not configured — skipping admin seed.');
    return;
  }
  const email = ADMIN_EMAIL.trim().toLowerCase();
  try {
    const { data: existing, error } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (existing) {
      console.log(`[admin] default admin already present (${email}).`);
      return;
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const { error: insErr } = await supabaseAdmin
      .from('admin_users')
      .insert({ email, password_hash: hash });
    if (insErr) throw insErr;
    console.log(`[admin] seeded default admin: ${email}`);
  } catch (err) {
    console.error('[admin] seed failed:', err?.message || err);
  }
}
