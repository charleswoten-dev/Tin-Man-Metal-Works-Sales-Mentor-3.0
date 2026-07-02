import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { buildThemes, parseLandingMockup, extractFaq } from '../lib/landingMockup.js';
import './LandingMockup.css';

// A visual, funnel-style mockup of the generated landing page — a design
// blueprint the owner can rebuild in ClickFunnels. Shows the FULL sales copy
// (no coaching labels), checkmark bullets, clip-art badges, and a CTA at every
// section break. Switch themes, then download as PNG or PDF.

// Clean, generic section labels + layout order. NONE of the coaching/framework
// wording ("Wicked Witch", "Emerald City", etc.) ever reaches the mockup.
const ORDER = ['audience', 'problem', 'dream', 'offer', 'benefits', 'proof', 'guarantee', 'faq'];
const META = {
  audience: { tag: "WHO IT'S FOR" },
  problem: { tag: 'THE PROBLEM' },
  dream: { tag: 'THE OUTCOME' },
  offer: { tag: 'THE OFFER', card: true },
  benefits: { tag: 'WHY US' },
  proof: { tag: 'PROOF', proof: true },
  guarantee: { tag: 'OUR GUARANTEE', badge: true },
  faq: { tag: 'FAQ' },
};
const CTA_LABELS = ['Get Started →', 'Claim Yours Today →', 'Get a Free Quote →', 'Order Yours Now →'];

export default function LandingMockup({ project, content, onClose }) {
  const themes = useMemo(() => buildThemes(project.name), [project.name]);
  const [themeIdx, setThemeIdx] = useState(0);
  const [showTags, setShowTags] = useState(true);
  const [busy, setBusy] = useState(null);
  const pageRef = useRef(null);

  const theme = themes[themeIdx] || themes[0];
  const v = theme.vars;
  const { heroBody, byRole, extras } = useMemo(() => parseLandingMockup(content), [content]);
  const sections = ORDER.filter((r) => byRole[r]);
  const faqItems = useMemo(() => (byRole.faq ? extractFaq(byRole.faq.body) : []), [byRole.faq]);

  const fileBase = `${project.name}-landing-mockup`
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

  async function capture() {
    const { default: html2canvas } = await import('html2canvas');
    const h = pageRef.current.scrollHeight;
    const scale = Math.max(1, Math.min(2, Math.floor((32000 / Math.max(h, 1)) * 100) / 100));
    return html2canvas(pageRef.current, {
      backgroundColor: v.page, scale, useCORS: true,
      windowWidth: pageRef.current.scrollWidth, windowHeight: h,
    });
  }
  async function downloadPng() {
    if (busy) return; setBusy('png');
    try {
      const canvas = await capture();
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png'); a.download = `${fileBase}.png`; a.click();
    } catch { /* ignore */ } finally { setBusy(null); }
  }
  async function downloadPdf() {
    if (busy) return; setBusy('pdf');
    try {
      const [{ jsPDF }, canvas] = await Promise.all([import('jspdf'), capture()]);
      const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
      const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      const iw = pw, ih = (canvas.height * iw) / canvas.width;
      const data = canvas.toDataURL('image/png');
      let left = ih, pos = 0;
      doc.addImage(data, 'PNG', 0, pos, iw, ih); left -= ph;
      while (left > 0) { pos -= ph; doc.addPage(); doc.addImage(data, 'PNG', 0, pos, iw, ih); left -= ph; }
      doc.save(`${fileBase}.pdf`);
    } catch { /* ignore */ } finally { setBusy(null); }
  }

  const Tag = ({ children, dark }) =>
    showTags ? <span className="lmk2-tag" style={{ color: dark ? v.heroInk : v.ink, borderColor: dark ? v.heroInk : v.ink }}>{children}</span> : null;
  const Cta = ({ children, big }) => (
    <button className={'lmk2-cta' + (big ? ' big' : '')} style={{ background: v.accent, color: v.accentText }}>{children}</button>
  );
  const Img = ({ label, h = 190 }) => (
    <div className="lmk2-img" style={{ background: v.img, color: v.muted, minHeight: h }}>
      <span className="lmk2-img-ic">🖼️</span><span>{label}</span>
    </div>
  );
  const Stars = ({ light }) => <span className="lmk2-stars" style={{ color: light ? '#ffcf3f' : v.ink }}>★★★★★</span>;

  return createPortal(
    <div className="lmk-overlay" onClick={onClose}>
      <div className="lmk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Landing page mockup">
        <header className="lmk-head">
          <div>
            <h3>🎨 Landing Page Mockup</h3>
            <span className="lmk-sub">{project.name} · a design blueprint for your funnel page</span>
          </div>
          <button className="lmk-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="lmk-toolbar">
          <span className="lmk-toolbar-label">Style</span>
          {themes.map((t, i) => (
            <button key={t.id} className={'lmk-theme-btn' + (i === themeIdx ? ' active' : '')} onClick={() => setThemeIdx(i)}>{t.name}</button>
          ))}
          <label className="lmk-toggle">
            <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
            Structure labels
          </label>
        </div>

        <div className="lmk-scroll">
          <div
            className="lmk2-page"
            ref={pageRef}
            style={{ background: v.page, color: v.text, '--lmk-head': v.heading, '--lmk-ck': v.ink, '--lmk-link': v.heading }}
          >
            {/* NAV */}
            <div className="lmk2-nav" style={{ background: v.navBg, color: v.navText }}>
              <span className="lmk2-logo">🔩 {project.name}</span>
              <Cta>Get a Quote →</Cta>
            </div>

            {/* HERO — full hero copy */}
            <section className="lmk2-hero" style={{ background: v.heroBg, color: v.heroText }}>
              <div className="lmk2-hero-copy">
                <Tag dark>HERO</Tag>
                <div className="lmk2-eyebrow" style={{ color: v.heroInk }}>★★★★★ TRUSTED BY REAL CUSTOMERS</div>
                <div className="lmk2-md lmk2-hero-md" style={{ '--lmk-head': v.heroText, '--lmk-ck': v.heroInk, color: v.heroText }}><ReactMarkdown>{heroBody}</ReactMarkdown></div>
                <Cta big>Claim Yours Today →</Cta>
                <div className="lmk2-trust" style={{ color: v.heroMuted }}><Stars light /> &nbsp;100% custom-built · Built to last</div>
              </div>
              <div className="lmk2-hero-img"><Img label="Hero photo / your best build" h={250} /></div>
            </section>

            {/* TRUST STRIP — clip-art trust badges */}
            <div className="lmk2-strip" style={{ background: v.band, borderColor: v.line, color: v.muted }}>
              <span>⭐ 5-Star Rated</span><span>🇺🇸 American-Made Steel</span>
              <span>🛡️ Rust-Through Warranty</span><span>🔨 Built by Hand</span>
            </div>

            {/* BODY SECTIONS — full copy, generic tags, CTA at every break */}
            {sections.map((role, i) => {
              const s = byRole[role]; const meta = META[role];
              const alt = i % 2 === 0;
              return (
                <section key={role} className="lmk2-sec" style={alt ? { background: v.band, borderTop: `1px solid ${v.line}` } : { borderTop: `1px solid ${v.line}` }}>
                  <Tag>{meta.tag}</Tag>

                  {meta.badge && (
                    <div className="lmk2-badge" style={{ borderColor: v.ink, color: v.ink, background: v.accentSoft }}>
                      <span className="lmk2-badge-ic">🛡️</span>
                      <div><strong>100% Guarantee</strong><br /><small>Risk-free — or your money back</small></div>
                    </div>
                  )}

                  {role === 'faq' && faqItems.length ? (
                    <>
                      <h3 className="lmk2-faq-title" style={{ color: v.heading }}>Frequently Asked Questions</h3>
                      <div className="lmk2-faq">
                        {faqItems.map((f, n) => (
                          <div key={n} className="lmk2-faq-item" style={{ borderColor: v.line }}>
                            <div className="lmk2-faq-q" style={{ color: v.text }}>{f.q}</div>
                            {f.a && <div className="lmk2-faq-a" style={{ color: v.muted }}>{f.a}</div>}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : meta.card ? (
                    <div className="lmk2-offer" style={{ background: v.card, borderColor: v.line }}>
                      <div className="lmk2-md"><ReactMarkdown>{s.body}</ReactMarkdown></div>
                      <div className="lmk2-price" style={{ borderColor: v.line }}>
                        <span className="lmk2-price-was" style={{ color: v.muted }}>Value $X,XXX</span>
                        <span className="lmk2-price-now" style={{ color: v.heading }}>Your Price: $ —</span>
                      </div>
                    </div>
                  ) : (
                    <div className="lmk2-md"><ReactMarkdown>{s.body}</ReactMarkdown></div>
                  )}

                  {meta.proof && (
                    <div className="lmk2-proof">
                      {[0, 1, 2].map((n) => (
                        <div key={n} className="lmk2-tcard" style={{ background: v.card, borderColor: v.line }}>
                          <div className="lmk2-avatar" style={{ background: v.accentSoft, color: v.ink }}>★</div>
                          <Stars />
                          <p style={{ color: v.muted }}>“Add a real customer review + photo here.”</p>
                          <span className="lmk2-tname">— Customer Name</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="lmk2-cta-wrap"><Cta>{CTA_LABELS[i % CTA_LABELS.length]}</Cta></div>
                </section>
              );
            })}

            {/* EXTRAS — full copy, no coaching label */}
            {extras.map((s, i) => (
              <section key={'x' + i} className="lmk2-sec" style={{ borderTop: `1px solid ${v.line}` }}>
                <div className="lmk2-md"><ReactMarkdown>{s.body}</ReactMarkdown></div>
                <div className="lmk2-cta-wrap"><Cta>{CTA_LABELS[i % CTA_LABELS.length]}</Cta></div>
              </section>
            ))}

            {/* FINAL CTA */}
            <section className="lmk2-final" style={{ background: v.heroBg, color: v.heroText }}>
              <Tag dark>CALL TO ACTION</Tag>
              <div className="lmk2-md lmk2-final-md" style={{ '--lmk-head': v.heroText }}>
                <ReactMarkdown>{byRole.cta?.body || 'Ready to make it yours?'}</ReactMarkdown>
              </div>
              <Cta big>Claim Yours Now →</Cta>
              <div className="lmk2-trust" style={{ color: v.heroMuted }}><Stars light /> &nbsp;🔒 Secure · 🚚 Delivered & set up · 🛡️ Guaranteed</div>
            </section>

            <div className="lmk2-foot" style={{ background: v.navBg, color: v.heroMuted }}>
              Mockup by Tin Man Metal Works Sales Mentor — rebuild this layout in ClickFunnels.
            </div>
          </div>
        </div>

        <footer className="lmk-actions">
          <span className="lmk-hint">A visual blueprint — download it to guide your ClickFunnels build.</span>
          <div className="lmk-buttons">
            <button className="lmk-btn" onClick={downloadPng} disabled={Boolean(busy)}>{busy === 'png' ? 'Building…' : 'Download PNG'}</button>
            <button className="lmk-btn primary" onClick={downloadPdf} disabled={Boolean(busy)}>{busy === 'pdf' ? 'Building…' : 'Download PDF'}</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
