// Parses the hidden control tokens the mentor emits during the guided
// walkthrough out of an assistant message, and returns the clean text to render
// plus the structured data the app acts on.
//
// Robustness matters here: these tokens sit at the very END of a message, so a
// truncated reply (hit max_tokens) can leave a half-emitted token behind. This
// parser must (a) NEVER let a `[[…]]` fragment render, and (b) not hinge step
// completion on a single fragile token.
//
// Markers:
//   [[STEP_DONE:ybr-N]]                     — step N completed
//   [[PROJECT_NAME:name]]                   — name for a freshly started project
//   [[STEP_SUMMARY:ybr-N]] … [[/STEP_SUMMARY]]   — the finalized deliverable for step N
//   [[DREAM_BUYER:name]] … [[/DREAM_BUYER]]      — a saveable dream-buyer avatar

const STEP = 'ybr-(?:1[0-7]|[1-9])';

export function extractWalkthroughMarkers(text) {
  const src = String(text || '');

  // Fresh regexes each call so a shared lastIndex can never leak between calls.
  const doneRe = new RegExp(`\\[\\[STEP_DONE:(${STEP})\\]\\]`, 'g');
  const nameRe = /\[\[PROJECT_NAME:([^\]\n]+)\]\]/g;
  const summaryRe = new RegExp(`\\[\\[STEP_SUMMARY:(${STEP})\\]\\]([\\s\\S]*?)\\[\\[\\/STEP_SUMMARY\\]\\]`, 'g');
  const dbRe = /\[\[DREAM_BUYER:([^\]\n]+)\]\]([\s\S]*?)\[\[\/DREAM_BUYER\]\]/g;

  const doneKeys = new Set();
  let m;
  while ((m = doneRe.exec(src))) doneKeys.add(m[1]);

  let projectName = null;
  let n;
  while ((n = nameRe.exec(src))) projectName = n[1].trim();

  const summaries = {};
  let s;
  while ((s = summaryRe.exec(src))) {
    const body = s[2].trim();
    if (body) summaries[s[1]] = body;
  }

  let dreamBuyer = null;
  let d;
  while ((d = dbRe.exec(src))) {
    const name = d[1].trim();
    const body = d[2].trim();
    if (name && body) dreamBuyer = { name, content: body };
  }

  const clean = cleanForDisplay(src);

  // A finished STEP_SUMMARY for a step ALSO means that step is done, so
  // completion no longer hinges on the STEP_DONE token surviving truncation.
  // And when the mentor drops BOTH tokens (it sometimes writes a step's
  // deliverable as plain visible text and forgets the hidden markers), fall back
  // to inferring completion from its own "Step N of 17" headers — the walkthrough
  // is strictly sequential, so reaching Step N means Steps 1..N-1 are done. Never
  // un-marks; only ever adds completions.
  const inferred = inferCompletedSteps(clean);
  const stepKeys = new Set([...doneKeys, ...Object.keys(summaries), ...inferred]);

  return { clean, stepKeys: [...stepKeys], projectName, summaries, dreamBuyer };
}

// The 17 canonical Yellow-Brick-Road step titles. The mentor's REAL step headers
// always pair the number with one of these ("Step 4 — Identify Their Wicked
// Witch"). Numbered list items the mentor writes INSIDE a deliverable (the
// buyer's journey "Step 4 — He hesitates") never carry a YBR title, so requiring
// one makes step detection immune to that content.
const YBR_TITLE =
  /(find your dream buyer|emerald city|yellow brick road|wicked witch|ruby slipper|power guarantee|dream buyer avatar|sales funnel|landing page|lead magnet|email (?:follow[- ]?up|sequence)|ad copy|consultative sale|deposit close|handle objections|follow up like a pro|track your numbers)/i;

// A walkthrough step header: "Step N of 17" OR "Step N — <a YBR title>". Both are
// things only the mentor's own headers produce; a numbered process/list inside a
// deliverable matches neither. Returns [ [n, matchText], … ].
function stepHeaders(src) {
  const out = [];
  let m;
  const ofRe = /\bstep\s+(\d{1,2})\s+of\s+17\b/gi;
  while ((m = ofRe.exec(src))) out.push([parseInt(m[1], 10), m[0]]);
  const titleRe = /\bstep\s+(\d{1,2})\s*[—–:-][^\n]{0,45}/gi;
  while ((m = titleRe.exec(src))) if (YBR_TITLE.test(m[0])) out.push([parseInt(m[1], 10), m[0]]);
  return out;
}

// The step numbers of every real header in a message (see stepHeaders), highest
// first. Used to tell when the mentor has ADVANCED to a new step.
export function stepHeaderNumbers(text) {
  return stepHeaders(String(text || ''))
    .map(([n]) => n)
    .filter((n) => n >= 1 && n <= 17);
}

// Infer which steps are complete from the mentor's visible text, for messages
// where the hidden [[STEP_DONE]]/[[STEP_SUMMARY]] markers were dropped. Trusts
// only real step headers (see stepHeaders) — reaching Step N means Steps 1..N-1
// are done. Content-immune: numbered lists inside a deliverable can't fool it.
export function inferCompletedSteps(text) {
  const src = String(text || '');
  const keys = new Set();

  // Whole-system completion — specific end-of-walkthrough phrasing (won't match
  // the kickoff's "…all 17 steps, one at a time", nor a forward-looking promise
  // like "by the end you'll have all 17 steps built"). The steps must be the
  // SUBJECT of a present/past completion state ("all 17 steps are done", "…have
  // been built"), never a bare future "…steps built". Covers the final step 17.
  if (
    /finished the full selling system/i.test(src) ||
    /walked the whole (?:yellow brick )?road/i.test(src) ||
    /all (?:17|seventeen) steps?\s+(?:are|were|have been)\s+(?:now\s+)?(?:done|complete|finished|built)\b/i.test(src) ||
    /you'?ve (?:now )?(?:completed|finished) (?:all )?(?:17|seventeen)\b/i.test(src)
  ) {
    for (let i = 1; i <= 17; i++) keys.add(`ybr-${i}`);
    return keys;
  }

  for (const [n] of stepHeaders(src)) {
    if (n >= 1 && n <= 18) for (let i = 1; i < n && i <= 17; i++) keys.add(`ybr-${i}`);
  }
  return keys;
}

// Which single step a message is ABOUT, for the one-click "Save step" button and
// the content safety net. Uses the FIRST real step header (the step the message
// is delivering, which appears before any "next step" mention). Content-immune.
// Returns a ybr key ('ybr-6') or null; when null the Save-step UI falls back to
// the manual picker and the safety net simply doesn't auto-capture.
export function stepKeyFromMessage(text) {
  const headers = stepHeaders(String(text || ''));
  if (!headers.length) return null;
  const x = headers[0][0];
  return x >= 1 && x <= 17 ? `ybr-${x}` : null;
}

// The display-safe text of a message that may still be mid-stream: the finalized
// STEP_SUMMARY / DREAM_BUYER blocks removed and every control token — whole,
// loose, or half-emitted — stripped. Used both for the final render and to reveal
// a reply live as it streams in, so a fragment like "[[STEP_SUMMARY:ybr-1]" never
// flashes on screen while the Tin Man is still writing.
export function cleanForDisplay(text) {
  const src = String(text || '');
  const summaryRe = new RegExp(`\\[\\[STEP_SUMMARY:(${STEP})\\]\\]([\\s\\S]*?)\\[\\[\\/STEP_SUMMARY\\]\\]`, 'g');
  const dbRe = /\[\[DREAM_BUYER:([^\]\n]+)\]\]([\s\S]*?)\[\[\/DREAM_BUYER\]\]/g;
  return stripControlTokens(src.replace(summaryRe, '').replace(dbRe, ''));
}

// Remove every trace of a control token — complete, loose, or half-emitted —
// so nothing like "[[STEP_SUMMARY:ybr-1] …" ever renders. Only known control
// tokens are targeted, never arbitrary bracketed text a user might type.
function stripControlTokens(t) {
  return t
    // A truncated block: an opener with no closing tag. Everything from the
    // opener to the end of the message is the half-written deliverable — hide it.
    .replace(/\n*\[\[(?:STEP_SUMMARY|DREAM_BUYER):[^\]\n]*\]\][\s\S]*$/i, '')
    // Loose single markers left behind anywhere.
    .replace(/\[\[STEP_DONE:[^\]\n]*\]\]/gi, '')
    .replace(/\[\[PROJECT_NAME:[^\]\n]*\]\]/gi, '')
    .replace(/\[\[\/(?:STEP_SUMMARY|DREAM_BUYER)\]\]/gi, '')
    // A partial opener truncated mid-token at the very tail: "[[STEP_SUMMARY:ybr"
    .replace(/\n*\[\[(?:STEP_DONE|STEP_SUMMARY|PROJECT_NAME|DREAM_BUYER)\b[^\]]*$/i, '')
    // A bare "[[" or "[[STEP" fragment truncated before the token name resolves.
    .replace(/\n*\[\[[A-Za-z_]{0,14}$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
