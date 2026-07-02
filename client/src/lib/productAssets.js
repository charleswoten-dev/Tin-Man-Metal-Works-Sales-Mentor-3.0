// Product-asset generators shown on a completed project. Each one turns the
// work already saved in the project's 17 Yellow Brick Road steps into a
// ready-to-use marketing asset (landing page, email sequence, ad, lead magnets).
//
// Each asset targets one YBR step so the result can be saved back into the
// project in the natural place:
//   landing page  -> ybr-9  (Write Your Landing Page)
//   lead magnets  -> ybr-10 (Create Your Lead Magnet)
//   email seq     -> ybr-11 (Write Your Email Follow Up Sequence)
//   sales ad      -> ybr-12 (Write Your Ad Copy)
import { YBR_STEPS } from './ybrSteps.js';

// Assemble everything the owner has built for this product into one context
// block the mentor can write from. Only steps with saved work are included.
export function buildProductContext(steps) {
  const parts = [];
  for (const step of YBR_STEPS) {
    const content = steps?.[step.key]?.content?.trim();
    if (content) parts.push(`## ${step.title}\n${content}`);
  }
  return parts.join('\n\n');
}

// True once there's at least some saved work to write from.
export function hasProductContext(steps) {
  return YBR_STEPS.some((s) => steps?.[s.key]?.content?.trim());
}

const INSTRUCTION =
  "You're writing a finished, ready-to-use asset for the owner — not coaching or " +
  'explaining. Write it in their voice as a hands-on metal-fabrication shop owner: ' +
  'plain-spoken, confident, no corporate fluff. Use their real product details below. ' +
  'Return only the asset itself in clean Markdown — no preamble like "Here\'s your...".';

export const PRODUCT_ASSETS = [
  {
    id: 'landing-page',
    label: 'Landing page',
    short: 'Landing page',
    icon: '📄',
    stepKey: 'ybr-9',
    stepLabel: 'Step 9 · Landing Page',
    docTitle: 'Landing Page',
    buildPrompt: (projectName, ctx) =>
      `You are the Tin Man writing a finished, high-converting landing page for the owner's product ` +
      `"${projectName}" — built the Yellow Brick Road way and structured like a real sales funnel page. ` +
      `Write in the owner's voice: a hands-on metal-fab shop owner — plain-spoken, confident, no corporate ` +
      `fluff. Use their real details below; no placeholders.\n\n` +
      `Build it as an ANNOTATED, section-by-section page so the owner can see what each part does and how it ` +
      `all fits together. Output the sections IN THE ORDER BELOW. For EACH section, output exactly three things:\n` +
      `1) a level-2 markdown heading (##) that names the section with a little sass, tied to Charles's ` +
      `framework — e.g. "## 🎯 The Hook — Grab 'Em by the Emerald City"\n` +
      `2) then ONE short *italic* line explaining what this section does and why it works (the teaching bit)\n` +
      `3) then the actual finished, ready-to-publish copy for that section.\n\n` +
      `The sections, in order:\n` +
      `- The Hook — headline + subhead that promise the Emerald City (their dream outcome) to the dream buyer\n` +
      `- Call Out Your Dream Buyer — a "this is for you if…" so the right person knows they're home\n` +
      `- Agitate the Wicked Witch — name the fears, frustrations, and objections keeping them stuck (twist the knife, kindly)\n` +
      `- Paint the Emerald City — the dream outcome and what life looks like once they own this\n` +
      `- The Ruby Slipper Offer — everything they get, laid out so it feels irresistible\n` +
      `- Why This Is Different — benefit bullets run through the Value Equation (bigger dream, more believable, faster, less effort)\n` +
      `- The Power Guarantee — the bold risk-reversal that removes the last hesitation\n` +
      `- Proof — where testimonials/build photos go (if they have none yet, tell them exactly what to drop in)\n` +
      `- Slay the Last Objections — a short FAQ that kills the final "yeah, but…"s\n` +
      `- The Call to Action — tell them exactly what to do next, with a nudge of urgency\n\n` +
      `Keep the section labels fun and plain-spoken, but keep the actual page copy sharp and ready to publish.\n\n` +
      `Here is everything the owner built for "${projectName}" on their Yellow Brick Road:\n\n${ctx}`,
  },
  {
    id: 'email-sequence',
    label: '7-part email sequence',
    short: 'Email sequence',
    icon: '✉️',
    stepKey: 'ybr-11',
    stepLabel: 'Step 11 · Email Sequence',
    docTitle: '7-Part Follow-Up Email Sequence',
    buildPrompt: (projectName, ctx) =>
      `${INSTRUCTION}\n\nWrite a complete 7-part follow-up email sequence for "${projectName}", built on ` +
      `Charles's 7-part follow-up funnel and the Magic Lantern nurture approach — carry a warm lead who just ` +
      `opted in all the way to buyer. Number the emails 1 through 7. For each, give a subject line PLUS one ` +
      `alternate subject, then the full body.\n\n` +
      `Walk the Yellow Brick Road across the sequence: open by connecting with the dream buyer and their ` +
      `Emerald City; use the middle emails to agitate the Wicked Witch (their objections) and dissolve them ` +
      `one at a time with story and proof; present the Ruby Slipper Offer and the Power Guarantee; then close ` +
      `with a clear call to action and a nudge of urgency. Pace it for someone who opted in but hasn't bought ` +
      `yet. Keep each email short and skimmable, and sound like a real shop owner — not a marketer.\n\n` +
      `Here is everything the owner built for "${projectName}":\n\n${ctx}`,
  },
  {
    id: 'sales-ad',
    label: 'Sales ad',
    short: 'Sales ad',
    icon: '📣',
    stepKey: 'ybr-12',
    stepLabel: 'Step 12 · Ad Copy',
    docTitle: 'Sales Ad',
    buildPrompt: (projectName, ctx) =>
      `${INSTRUCTION}\n\nWrite a scroll-stopping Facebook/Instagram sales ad for "${projectName}", built for ` +
      `COLD traffic — people who don't know the shop yet. Give me 3 hook/headline options that stop the scroll, ` +
      `the primary ad body copy, and one clear call to action.\n\n` +
      `Use Charles's approach: call out the dream buyer fast, poke the Wicked Witch (their problem/frustration) ` +
      `in the very first line, flash the Emerald City (the dream outcome), tease the Ruby Slipper Offer, and ` +
      `drive one single action. Match a cold-traffic temperature — curiosity and pattern-interrupt over hard ` +
      `selling. Sound like a real shop owner.\n\n` +
      `Here is everything the owner built for "${projectName}":\n\n${ctx}`,
  },
  {
    id: 'lead-magnets',
    label: '3 lead magnet ideas',
    short: 'Lead magnets',
    icon: '🧲',
    stepKey: 'ybr-10',
    stepLabel: 'Step 10 · Lead Magnet',
    docTitle: '3 Lead Magnet Ideas',
    buildPrompt: (projectName, ctx) =>
      `${INSTRUCTION}\n\nGive me exactly 3 lead magnet ideas for "${projectName}", realistic for a one-person ` +
      `metal shop to create. Each should be a high-value free offer that attracts the DREAM BUYER, hands them ` +
      `the first step of their Yellow Brick Road (a fast win toward the Emerald City), and warms up a cold ` +
      `prospect so the paid offer becomes the obvious next step.\n\n` +
      `Format each idea EXACTLY like this — start each with a level-3 heading (###), and put nothing before ` +
      `the first heading:\n\n` +
      `### <short punchy title>\n**What it is:** <one line>\n` +
      `**Why my dream buyer wants it:** <one line — tie it to their Emerald City>\n` +
      `**How it leads to a sale:** <one line — how it walks them toward the offer>\n\n` +
      `Here is everything the owner built for "${projectName}":\n\n${ctx}`,
  },
];

// Build the actual worked example of ONE lead magnet idea (the finished piece
// the dream buyer would receive), used by the per-idea "See an example" button.
export function buildLeadMagnetExamplePrompt(projectName, ideaTitle, ideaBody, ctx) {
  return (
    `${INSTRUCTION}\n\nBelow is one lead magnet idea for my product "${projectName}". Build the ACTUAL, ` +
    `finished lead magnet — the real piece my dream buyer would receive, written out in full and ready ` +
    `to use (not a description of it, not instructions to me). Give it a clear title and complete, usable ` +
    `content that delivers a real quick win toward their Emerald City, and end it by naturally pointing them ` +
    `toward the paid offer as the obvious next step down the Yellow Brick Road.\n\n` +
    `Lead magnet idea:\n### ${ideaTitle}\n${ideaBody}\n\n` +
    `Here is everything the owner built for "${projectName}":\n\n${ctx}`
  );
}

// Split the 3-ideas Markdown into [{ title, body }]. Primary split is on the
// ### headings we ask for; falls back to ## or numbered lists if the model
// strays, and to a single idea as a last resort.
export function parseLeadMagnetIdeas(md) {
  const text = String(md || '').trim();
  if (!text) return [];
  const toIdeas = (chunks) =>
    chunks
      .map((c) => c.trim())
      .filter(Boolean)
      .map((chunk) => {
        const nl = chunk.indexOf('\n');
        const rawTitle = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
        const title = rawTitle
          .replace(/^#{1,6}\s*/, '')
          .replace(/^\d+[.):]?\s*/, '')
          .replace(/^Idea\s*\d*\s*[:.\-]?\s*/i, '')
          .replace(/\*\*/g, '')
          .trim();
        const body = nl === -1 ? '' : chunk.slice(nl + 1).trim();
        return { title, body };
      })
      .filter((idea) => idea.title || idea.body);

  // Prefer ### headings.
  let parts = text.split(/^###\s+/m);
  if (parts.length >= 2) return toIdeas(parts).filter((i) => i.title);
  // Fall back to ## headings.
  parts = text.split(/^##\s+/m);
  if (parts.length >= 2) return toIdeas(parts).filter((i) => i.title);
  // Fall back to numbered items at the start of a line.
  parts = text.split(/\n(?=\d+[.)]\s+)/);
  if (parts.length >= 2) return toIdeas(parts);
  // Last resort: treat the whole thing as one idea.
  return toIdeas([text]);
}

// Remove emoji/pictographs. PDF text fonts can't render color emoji, so we
// strip them for the (selectable, light-theme) PDF — cleaner copy anyway.
function stripEmoji(s) {
  return String(s || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[️‍⃣]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Split a line into styled runs, honoring **bold** and stripping other inline
// Markdown (italic, code, links) so the text stays clean and copy-pasteable.
function parseInline(text) {
  const clean = stripEmoji(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/(^|[^*])\*(?!\*)([^*]+)\*(?!\*)/g, '$1$2'); // italic -> plain
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(clean))) {
    if (m.index > last) runs.push({ text: clean.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = re.lastIndex;
  }
  if (last < clean.length) runs.push({ text: clean.slice(last), bold: false });
  return runs.length ? runs : [{ text: clean, bold: false }];
}

// Render Markdown into a jsPDF doc as REAL, selectable text on a light page:
// sized/bold headings, inline bold, bullets, numbered lists, wrapping + paging.
// `doc` is a jsPDF instance (passed in so this file needs no jsPDF import).
export function renderMarkdownToPdf(doc, markdown, { title } = {}) {
  const margin = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  const BODY = [31, 33, 31];       // near-black
  const HEAD = [17, 122, 58];      // brand green, readable on white
  let y = margin;

  const ensure = (h) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Lay out styled runs with word wrap, an optional bullet marker, and indent.
  function renderRuns(runs, { size, color, indent = 0, marker = null, gapAfter = 4 }) {
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lineH = size * 1.4;
    const startX = margin + indent;
    let x = startX;
    ensure(lineH);
    if (marker) {
      doc.setFont('helvetica', 'normal');
      doc.text(marker, margin + indent - 14, y + size);
    }
    const words = [];
    runs.forEach((r) => {
      r.text.split(/(\s+)/).forEach((w) => {
        if (w !== '') words.push({ t: w, bold: r.bold });
      });
    });
    let atLineStart = true;
    words.forEach((word) => {
      if (atLineStart && /^\s+$/.test(word.t)) return; // drop leading spaces
      doc.setFont('helvetica', word.bold ? 'bold' : 'normal');
      const w = doc.getTextWidth(word.t);
      if (!atLineStart && x + w > margin + maxW) {
        y += lineH;
        x = startX;
        ensure(lineH);
        if (/^\s+$/.test(word.t)) return;
      }
      doc.text(word.t, x, y + size);
      x += w;
      atLineStart = false;
    });
    y += lineH + gapAfter;
  }

  if (title) {
    renderRuns([{ text: stripEmoji(title), bold: true }], { size: 20, color: HEAD, gapAfter: 6 });
    doc.setDrawColor(210, 214, 210);
    doc.line(margin, y - 2, pageW - margin, y - 2);
    y += 10;
  }

  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      y += 6;
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      const level = m[1].length;
      const size = level <= 1 ? 16 : level === 2 ? 13.5 : 12;
      y += 6;
      renderRuns([{ text: stripEmoji(m[2]), bold: true }], { size, color: HEAD, gapAfter: 4 });
      continue;
    }
    if ((m = line.match(/^\s*(?:[-*]|\p{Extended_Pictographic}️?)\s+(.*)/u))) {
      renderRuns(parseInline(m[1]), { size: 11, color: BODY, indent: 18, marker: '•', gapAfter: 3 });
      continue;
    }
    if ((m = line.match(/^\s*(\d+)\.\s+(.*)/))) {
      renderRuns(parseInline(m[2]), { size: 11, color: BODY, indent: 18, marker: m[1] + '.', gapAfter: 3 });
      continue;
    }
    renderRuns(parseInline(line), { size: 11, color: BODY, gapAfter: 5 });
  }
}
