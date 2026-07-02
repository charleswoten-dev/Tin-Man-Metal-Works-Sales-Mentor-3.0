// Turns a generated (annotated) landing-page Markdown doc into structured
// funnel sections and defines the visual themes for the mockup. The landing-page
// generator labels each section "## <emoji> <name>" with a leading *italic*
// explainer; we classify by the name and strip the teaching bits.

// ---- Color helpers for building high-contrast themes ----
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum(hex) {
  const c = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function readableOn(bg) {
  return contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111';
}
function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const d = (x) => Math.max(0, Math.round(x * (1 - amt)));
  return '#' + [d(r), d(g), d(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const l = (x) => Math.min(255, Math.round(x + (255 - x) * amt));
  return '#' + [l(r), l(g), l(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Nudge a color darker (on light bg) or lighter (on dark bg) until it clears a
// target contrast ratio against that background — so text is always readable.
function readableColor(color, bg, target) {
  const bgLight = relLum(bg) > 0.4;
  let c = color;
  for (let i = 0; i < 16 && contrast(c, bg) < target; i++) {
    c = bgLight ? darken(c, 0.09) : lighten(c, 0.12);
  }
  return c;
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function hashStr(s) {
  let h = 0;
  const str = String(s || 'tinman');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Build one theme from a single accent color: white body, black-ish text,
// accent-colored headlines + CTA, and a dark accent-tinted hero.
function themeFromAccent(accent, name, id) {
  // Keep the hero genuinely dark (even for light accents like teal) so ALL
  // text on it — white headline, muted subhead, accent eyebrow — is high-contrast.
  const heroTop = darken(accent, 0.34);
  const heroBottom = darken(accent, 0.66);
  return {
    id, name,
    vars: {
      page: '#ffffff', band: '#f4f7fb', card: '#ffffff', line: '#e4e8ef',
      text: '#12151a', muted: '#586170',
      // Section headings (large text) readable on white; small accent text
      // (tags, checkmarks) held to a stricter ratio.
      heading: readableColor(accent, '#ffffff', 3.4),
      ink: readableColor(accent, '#ffffff', 4.6),
      heroBg: `linear-gradient(160deg, ${heroTop} 0%, ${heroBottom} 100%)`,
      heroText: '#ffffff', heroMuted: 'rgba(255,255,255,0.94)',
      // Accent text placed ON the dark hero — lightened until high-contrast.
      heroInk: readableColor(lighten(accent, 0.3), heroTop, 4.6),
      accent, accentText: readableOn(accent), accentSoft: rgba(accent, 0.1),
      img: '#eaeef4', navBg: darken(accent, 0.62), navText: '#ffffff',
    },
  };
}

// Kept visibly distinct from the default blue and from each other: one warm
// accent + one green/cool accent, both high-contrast on white.
const WARM_PALETTES = [
  ['#dc2626', 'Crimson'], ['#ea580c', 'Orange'], ['#db2777', 'Magenta'], ['#b45309', 'Bronze'],
];
const COOL_PALETTES = [
  ['#059669', 'Emerald'], ['#0d9488', 'Teal'], ['#16a34a', 'Green'], ['#7c3aed', 'Violet'],
];

// Three example styles: Classic Blue (the default — blue headlines, black body,
// blue CTAs) plus one warm and one cool high-contrast palette, chosen
// deterministically from the project name so they stay stable between renders.
export function buildThemes(seed) {
  const blue = themeFromAccent('#1d4ed8', 'Classic Blue', 'blue');
  const h = hashStr(seed);
  const w = WARM_PALETTES[h % WARM_PALETTES.length];
  const c = COOL_PALETTES[(h >> 3) % COOL_PALETTES.length];
  return [blue, themeFromAccent(w[0], w[1], 'w-' + w[1]), themeFromAccent(c[0], c[1], 'c-' + c[1])];
}

const ROLE_RULES = [
  { role: 'hero', tag: 'HERO', re: /hook/i },
  { role: 'audience', tag: "WHO IT'S FOR", re: /call out|dream buyer|right place|for you/i },
  { role: 'problem', tag: 'THE PROBLEM', re: /wicked witch|agitate|stuck|frustrat|\bpain\b/i },
  { role: 'dream', tag: 'THE DREAM', re: /emerald city|paint|other side|dream outcome/i },
  { role: 'offer', tag: 'THE OFFER', re: /ruby slipper|offer|what.*(get|included)/i },
  { role: 'benefits', tag: 'WHY IT’S DIFFERENT', re: /different|value equation|why this/i },
  { role: 'guarantee', tag: 'GUARANTEE', re: /guarantee|risk/i },
  { role: 'proof', tag: 'PROOF', re: /proof|testimonial|reviews|social/i },
  { role: 'faq', tag: 'FAQ', re: /objection|faq|yeah.*but|questions/i },
  { role: 'cta', tag: 'CALL TO ACTION', re: /call to action|cta|what to do|ready|get started/i },
];

function classify(label) {
  for (const r of ROLE_RULES) if (r.re.test(label)) return r;
  return { role: 'section', tag: 'MORE' };
}

function clean(s) {
  return String(s || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractHero(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter((l) => l && l !== '---');
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => clean(l));
  const paras = lines.filter((l) => !/^#{1,6}\s/.test(l)).map((l) => clean(l));
  const headline = headings[0] || paras[0] || 'Your Big Promise Goes Here';
  const subhead = headings[1] || (headings[0] ? paras[0] : paras[1]) || '';
  return { headline, subhead };
}

// A mockup is a design blueprint, not the final page — show a representative
// snippet of each section's copy (first sentence or two), not the whole thing.
export function condense(body, maxChars = 300) {
  const t = String(body || '')
    .replace(/^\s*[-*]\s+/gm, '') // flatten bullets to sentences for the snippet
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const dot = cut.lastIndexOf('. ');
  return (dot > maxChars * 0.5 ? cut.slice(0, dot + 1) : cut.trim() + '…');
}

// Pull clean bullet strings out of a section body (for checklists). Handles
// real Markdown bullets first; if the model wrote them inline with ✅/✓ marks,
// split on those instead so the offer/benefits still render as a checklist.
export function extractBullets(body) {
  const t = String(body || '');
  const std = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^([-*]|\d+[.)])\s+/.test(l))
    .map((l) => clean(l.replace(/^([-*]|\d+[.)])\s+/, '')))
    .filter(Boolean);
  if (std.length >= 2) return std;

  const checks = (t.match(/[✅✔✓]/g) || []).length;
  if (checks >= 2) {
    return t
      .split(/[✅✔✓]️?\s*/)
      .map((s) => clean(s))
      .filter((s) => s && s.length > 2 && !/^(here'?s|everything|when you order|included)/i.test(s));
  }
  return std;
}

// Pull simple Q/A pairs from an FAQ section (bold question, following text = answer).
export function extractFaq(body) {
  const out = [];
  const lines = String(body || '').split('\n');
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const q = line.match(/^\**(.+?\?)\**\s*(.*)$/); // a line containing a question
    const boldQ = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
    if (boldQ && /\?/.test(boldQ[1])) {
      if (cur) out.push(cur);
      cur = { q: clean(boldQ[1]), a: clean(boldQ[2]) };
    } else if (q && q[1] && line.length < 120 && !cur?.a) {
      if (cur) out.push(cur);
      cur = { q: clean(q[1]), a: clean(q[2]) };
    } else if (cur) {
      cur.a = (cur.a ? cur.a + ' ' : '') + clean(line);
    }
  }
  if (cur) out.push(cur);
  return out.filter((f) => f.q);
}

export function parseLandingMockup(md) {
  const text = String(md || '').trim();
  const parts = text.split(/^##\s+/m).map((s) => s.trim()).filter(Boolean);

  const sections = [];
  for (const chunk of parts) {
    const nl = chunk.indexOf('\n');
    const label = clean(nl === -1 ? chunk : chunk.slice(0, nl));
    if (/landing page$|annotated|yellow brick road way/i.test(label)) continue;
    let body = nl === -1 ? '' : chunk.slice(nl + 1).trim();
    body = body
      .replace(/^\s*\*[^*][\s\S]*?\*\s*(\n|$)/, '')
      .replace(/^\s*---\s*$/gm, '')
      .trim();
    const { role, tag } = classify(label);
    sections.push({ role, tag, label: clean(label), body });
  }

  const seen = new Set();
  const ordered = sections.filter((s) => {
    if (s.role === 'section') return true;
    if (seen.has(s.role)) return false;
    seen.add(s.role);
    return true;
  });

  const hero = ordered.find((s) => s.role === 'hero');

  // Index the rest by role for a clean, fixed professional layout order.
  const byRole = {};
  const extras = [];
  ordered.forEach((s) => {
    if (s.role === 'hero') return;
    if (s.role === 'section') extras.push(s);
    else if (!byRole[s.role]) byRole[s.role] = s;
  });

  // Full hero copy (real headline/subhead/lines) with the framework label and
  // teaching explainer already stripped — that's the sales copy we want shown.
  return { heroBody: hero?.body || '', byRole, extras };
}
