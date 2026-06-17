// Thin wrapper for talking to the Tin Man backend.
// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.js).
const BASE = import.meta.env.VITE_API_BASE || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A network-level failure (TypeError "Failed to fetch") means the request never
// got a response — the dev server briefly dropped the connection (e.g. a
// `node --watch` restart) or the socket flapped. These are transient and safe
// to retry: nothing was processed server-side. HTTP error *responses* (4xx/5xx)
// are NOT retried here — those carry a status and the request did reach the
// server, so the caller should handle them.
function isTransientNetworkError(err) {
  return err instanceof TypeError;
}

export async function apiPost(path, body, { retries = 2, backoffMs = 600 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(`${BASE}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
      return res.json();
    } catch (err) {
      // Only retry transient connection drops, and only while attempts remain.
      if (isTransientNetworkError(err) && attempt < retries) {
        await sleep(backoffMs * (attempt + 1)); // linear backoff: 600ms, 1200ms
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
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
