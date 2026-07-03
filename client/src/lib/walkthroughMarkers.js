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

  // A finished STEP_SUMMARY for a step ALSO means that step is done, so
  // completion no longer hinges on the STEP_DONE token surviving truncation.
  const stepKeys = new Set([...doneKeys, ...Object.keys(summaries)]);

  const clean = stripControlTokens(src.replace(summaryRe, '').replace(dbRe, ''));

  return { clean, stepKeys: [...stepKeys], projectName, summaries, dreamBuyer };
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
