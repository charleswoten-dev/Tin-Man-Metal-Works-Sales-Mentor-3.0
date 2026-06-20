// ---------------------------------------------------------------------------
// One-click data handoff from the free Shop Rate Calculator.
//
// The free calculator (a separate web address) can't write into this app's
// storage directly, so it attaches the visitor's saved shop rate + quotes to
// the upgrade link as a base64url blob in the URL hash (#import=...). On load we
// decode + stash it in localStorage so it survives the signup/purchase/login
// flow, then the ImportCalculatorData prompt offers to write it into the user's
// account once they're signed in. See upgradeLink.js in the calculator app.
// ---------------------------------------------------------------------------

const PENDING_KEY = 'tinman:pendingImport';

// Fired when a pending import is stashed (e.g. a code pasted in Settings) so the
// ImportCalculatorData prompt can pick it up without a page reload.
export const IMPORT_STASHED_EVENT = 'tinman:pending-import-set';

// UTF-8-safe base64url decode (mirror of the calculator's encodePayload).
function decodePayload(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json);
}

// Run once at startup (from main.jsx). If the URL hash carries an import payload,
// decode + stash it, then strip the hash so it never lingers or re-triggers.
export function captureIncomingImport() {
  try {
    const hash = window.location.hash || '';
    const m = hash.match(/[#&]import=([^&]+)/);
    if (m) {
      const payload = decodePayload(decodeURIComponent(m[1]));
      const hasRate = payload && payload.rate && typeof payload.rate === 'object';
      const hasQuotes = payload && Array.isArray(payload.quotes) && payload.quotes.length > 0;
      if (payload && payload.v === 1 && (hasRate || hasQuotes)) {
        localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      }
    }
  } catch {
    /* ignore malformed/oversized payloads — nothing to import */
  } finally {
    // Always strip an import hash from the address bar, even if decoding failed.
    try {
      if (/[#&]import=/.test(window.location.hash || '')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch {
      /* noop */
    }
  }
}

// Manual path: a buyer pastes the import code copied from the free calculator
// (Settings → "Import from the free calculator"). Tolerates a bare code or a
// full pasted upgrade URL (…#import=CODE). On success, stashes the payload and
// fires IMPORT_STASHED_EVENT so the ImportCalculatorData prompt appears.
export function stashImportFromCode(code) {
  try {
    let raw = String(code || '').trim();
    if (!raw) return { ok: false, error: 'empty' };
    // If they pasted a whole URL, pull the import param out of it.
    const m = raw.match(/[#?&]import=([^&\s]+)/);
    if (m) raw = decodeURIComponent(m[1]);

    const payload = decodePayload(raw);
    const hasRate = payload && payload.rate && typeof payload.rate === 'object';
    const hasQuotes = payload && Array.isArray(payload.quotes) && payload.quotes.length > 0;
    if (!payload || payload.v !== 1 || (!hasRate && !hasQuotes)) {
      return { ok: false, error: 'invalid' };
    }

    localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    try { window.dispatchEvent(new Event(IMPORT_STASHED_EVENT)); } catch { /* noop */ }
    return { ok: true, hasRate, quoteCount: hasQuotes ? payload.quotes.length : 0 };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function getPendingImport() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingImport() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* noop */
  }
}
