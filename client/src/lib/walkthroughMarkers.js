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

  const clean = stripControlTokens(src.replace(summaryRe, '').replace(dbRe, ''));

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

// Infer which steps are complete from the mentor's visible text, for messages
// where the hidden [[STEP_DONE]]/[[STEP_SUMMARY]] markers were dropped.
//
// CONTENT-IMMUNE: we only ever trust the mentor's own canonical header, which is
// ALWAYS "Step N of 17". Bare "Step N" / "Step N — …" mentions are ignored,
// because the mentor writes numbered lists like "Step 1… Step 5" INSIDE a
// deliverable (e.g. the buyer's journey in Step 3), and reading those as
// walkthrough steps used to mark steps complete before the user reached them.
// Reaching "Step N of 17" means the mentor is on N, so Steps 1..N-1 are done.
export function inferCompletedSteps(text) {
  const src = String(text || '');
  const keys = new Set();

  // Whole-system completion — specific end-of-walkthrough phrasing (won't match
  // the kickoff's "…all 17 steps, one at a time"). Covers the final step 17.
  if (
    /finished the full selling system/i.test(src) ||
    /walked the whole (?:yellow brick )?road/i.test(src) ||
    /all (?:17|seventeen) steps?[^.!?\n]*\b(?:done|complete|finished|built)\b/i.test(src) ||
    /you'?ve (?:now )?(?:completed|finished) (?:all )?(?:17|seventeen)\b/i.test(src)
  ) {
    for (let i = 1; i <= 17; i++) keys.add(`ybr-${i}`);
    return keys;
  }

  // The ONLY step-number signal we trust: "Step N of 17".
  let m;
  const ofRe = /\bstep\s+(\d{1,2})\s+of\s+17\b/gi;
  while ((m = ofRe.exec(src))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 18) for (let i = 1; i < n && i <= 17; i++) keys.add(`ybr-${i}`);
  }
  return keys;
}

// Which single step a message is ABOUT, for the one-click "Save step" button and
// the content safety net. Only trusts the mentor's canonical "Step N of 17"
// header (content-immune — a numbered list inside a deliverable can't fool it).
// Returns a ybr key ('ybr-6') or null; when null the Save-step UI falls back to
// the manual picker and the safety net simply doesn't auto-capture.
export function stepKeyFromMessage(text) {
  const m = String(text || '').match(/\bstep\s+(\d{1,2})\s+of\s+17\b/i);
  if (!m) return null;
  const x = parseInt(m[1], 10);
  return x >= 1 && x <= 17 ? `ybr-${x}` : null;
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
