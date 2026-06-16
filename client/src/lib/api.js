// Thin wrapper for talking to the Tin Man backend.
// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.js).
const BASE = import.meta.env.VITE_API_BASE || '';

export async function apiPost(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// Like apiPost but never throws on HTTP errors — returns { status, ok, data }
// so callers can read structured error bodies (e.g. 409 conflict, 429 rate limit).
export async function apiPostSafe(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}
