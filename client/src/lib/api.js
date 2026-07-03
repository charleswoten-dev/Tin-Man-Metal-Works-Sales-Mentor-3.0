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

// Streaming POST for long generations (product assets). Reads the Server-Sent
// Events body and calls onText(fullSoFar, delta) as each chunk arrives; resolves
// with the complete text. Throws on HTTP error or a streamed { error }.
//
// `idleMs`: if no bytes (not even the server's keepalive) arrive for this long,
// the stream is considered dead — abort so the caller's UI can recover instead
// of spinning forever. The server sends a keepalive every ~15s, so 40s of
// total silence means the connection is genuinely gone.
export async function apiStream(path, body, onText, { idleMs = 40000 } = {}) {
  const controller = new AbortController();
  let idleTimer;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleMs);
  };

  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    clearTimeout(idleTimer);
    let msg = `API ${path} failed: ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* no JSON body */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  try {
    armIdle();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle(); // any byte (data OR keepalive) means the stream is alive
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        // Ignore SSE comment lines (keepalives start with ':').
        if (!chunk.startsWith('data: ')) continue;
        const line = chunk.slice(6);
        if (!line) continue;
        let payload;
        try {
          payload = JSON.parse(line);
        } catch {
          continue;
        }
        if (payload.error) throw new Error(payload.error);
        if (payload.text) {
          full += payload.text;
          onText?.(full, payload.text);
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('The response stalled and was cut off. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(idleTimer);
  }
  return full.trim();
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
