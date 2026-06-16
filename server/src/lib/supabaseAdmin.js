import { createClient } from '@supabase/supabase-js';

// Service-role Supabase client. This bypasses Row Level Security, so it is the
// ONLY way the backend can read/write the locked-down license tables
// (licenses, approved_buyers, admin_users, webhook_logs). It must never be
// exposed to the browser.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLACEHOLDER = 'PASTE_YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE';

export const isAdminConfigured = Boolean(
  url && serviceKey && serviceKey !== PLACEHOLDER
);

if (!isAdminConfigured) {
  console.warn(
    '[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY is not set — license/admin/webhook ' +
      'features will return a configuration error until it is added to server/.env.'
  );
}

// Created even when unconfigured so imports don't throw; calls will fail loudly.
export const supabaseAdmin = createClient(url || 'http://localhost', serviceKey || 'missing', {
  auth: { autoRefreshToken: false, persistSession: false },
});
