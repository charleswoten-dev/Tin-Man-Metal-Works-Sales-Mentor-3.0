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
  // deliverable as plain visible text and forgets the hidden markers, especially
  // when moving fast), fall back to inferring completion from its own step
  // language — the walkthrough is strictly sequential, so reaching Step N means
  // Steps 1..N-1 are done. Never un-marks; only ever adds completions.
  const inferred = inferCompletedSteps(clean, doneKeys.size > 0 || Object.keys(summaries).length > 0);
  const stepKeys = new Set([...doneKeys, ...Object.keys(summaries), ...inferred]);

  return { clean, stepKeys: [...stepKeys], projectName, summaries, dreamBuyer };
}

// Distinctive Yellow-Brick-Road step titles — used (with "of 17" / "17-step")
// to confirm a message is genuinely part of the guided walkthrough before we
// infer anything from step-number language, so ordinary coaching chat that
// happens to say "step 2" can never move the user's progress.
const YBR_TITLES =
  /\b(yellow brick road|emerald city|wicked witch|ruby slipper|power guarantee|dream buyer avatar|sales funnel|landing page|lead magnet|email (?:follow[- ]?up|sequence)|ad copy|consultative sale|deposit close|handle objections|follow up like a pro|track your numbers|find your dream buyer)\b/i;

// Infer which steps are complete from the mentor's visible text, for messages
// where the hidden [[STEP_DONE]]/[[STEP_SUMMARY]] markers were dropped.
export function inferCompletedSteps(text, hasMarker = false) {
  const src = String(text || '');
  const keys = new Set();
  const addUpTo = (n) => {
    const x = parseInt(n, 10);
    if (x >= 1 && x <= 18) for (let i = 1; i < x && i <= 17; i++) keys.add(`ybr-${i}`);
  };
  const addOne = (n) => {
    const x = parseInt(n, 10);
    if (x >= 1 && x <= 17) keys.add(`ybr-${x}`);
  };

  // Whole-system completion — very specific end-of-walkthrough phrasing, safe to
  // check on any message (won't match the kickoff's "…all 17 steps, one at a time").
  if (
    /finished the full selling system/i.test(src) ||
    /walked the whole (?:yellow brick )?road/i.test(src) ||
    /all (?:17|seventeen) steps?[^.!?\n]*\b(?:done|complete|finished|built)\b/i.test(src) ||
    /you'?ve (?:now )?(?:completed|finished) (?:all )?(?:17|seventeen)\b/i.test(src)
  ) {
    for (let i = 1; i <= 17; i++) keys.add(`ybr-${i}`);
    return keys;
  }

  // Only mine step numbers from a message that's clearly part of the walkthrough.
  const isWalkthrough = /\bof\s+17\b/i.test(src) || /\b17[-\s]step\b/i.test(src) || YBR_TITLES.test(src) || hasMarker;
  if (!isWalkthrough) return keys;

  let m;
  // A step header the mentor is delivering — "Step N of 17", "Step N — Title",
  // or "Step N: Title" → the mentor is on N, so 1..N-1 are done. Requires the
  // "of 17" / dash / colon right after the number, so a passing "step 2 is…" in
  // ordinary chat never matches.
  const headRe = /\bstep\s+(\d{1,2})\s*(?:of\s+17\b|[—–:-])/gi;
  while ((m = headRe.exec(src))) addUpTo(m[1]);
  // Advancing to Step N ("move/roll/dive/jump/head to/into Step N", "ready for
  // Step N", "next up: Step N") → 1..N-1 are done.
  const fwdRe = /\b(?:move|moving|roll|rolling|jump|jumping|dive|diving|head|heading|onto|on)\s+(?:on\s+|right\s+|straight\s+)?(?:to|into)\s+step\s+(\d{1,2})/gi;
  while ((m = fwdRe.exec(src))) addUpTo(m[1]);
  const readyRe = /\b(?:ready\s+for|next\s+up[:,]?\s*(?:is\s+)?)\s*step\s+(\d{1,2})/gi;
  while ((m = readyRe.exec(src))) addUpTo(m[1]);
  // Direct completion of a specific step ("finished Step N", "Step N … locked in").
  const finRe = /\bfinished\s+step\s+(\d{1,2})/gi;
  while ((m = finRe.exec(src))) addOne(m[1]);
  const lockRe = /\bstep\s+(\d{1,2})\b[^\n]{0,28}?(?:locked in|✅|— done|is done|now complete|is complete)/gi;
  while ((m = lockRe.exec(src))) addOne(m[1]);

  return keys;
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
