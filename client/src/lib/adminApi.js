// Admin-panel API client. The admin JWT is kept in localStorage, entirely
// separate from the Supabase user session — admin access never depends on a
// user being signed in.
const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'tinman_admin_token';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setAdminToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Returns { status, ok, data }. Never throws on HTTP errors.
export async function adminFetch(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}/api/admin${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

// CSV download needs the raw response (text), not JSON.
export async function adminDownload(path, filename) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    headers: { Authorization: `Bearer ${getAdminToken()}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
