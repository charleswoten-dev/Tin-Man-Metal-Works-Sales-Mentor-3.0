import { useCallback, useEffect, useState } from 'react';
import './PricingTour.css';

// ---------------------------------------------------------------------------
// First-time spotlight tour for the Pricing & Quotes tool. Walks the user
// field-by-field: dims the screen, highlights one target (found via a data-tour
// selector), and shows a plain-English bubble. Each step can ask the parent to
// switch tab/mode/method first (via onPrepare) so the field it points at is
// actually on screen. Shared verbatim with the free standalone calculator.
// ---------------------------------------------------------------------------

const PAD = 8; // breathing room around the spotlighted element

export default function PricingTour({ steps, run, onPrepare, onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect (viewport coords) or null = centered

  const step = run ? steps[i] : null;

  // Always start from the first step whenever the tour is (re)opened.
  useEffect(() => { if (run) setI(0); }, [run]);

  const measure = useCallback(() => {
    if (!step) return;
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // On entering a step: let the parent set tab/mode/method, then scroll the
  // target into view and measure once the DOM has settled.
  useEffect(() => {
    if (!step) return;
    onPrepare?.(step);
    let raf2;
    const t = setTimeout(() => {
      const el = step.target ? document.querySelector(step.target) : null;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // measure a couple frames later so layout/scroll has applied
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(measure); });
      return () => cancelAnimationFrame(raf1);
    }, 80);
    return () => { clearTimeout(t); if (raf2) cancelAnimationFrame(raf2); };
  }, [step, onPrepare, measure]);

  // Keep the spotlight glued to the element as the page scrolls/resizes.
  useEffect(() => {
    if (!run) return;
    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [run, measure]);

  // Esc closes; arrow keys navigate.
  useEffect(() => {
    if (!run) return;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, i, steps.length]);

  if (!run || !step) return null;

  const last = i === steps.length - 1;
  const finish = () => { setI(0); onClose?.(); };
  const go = (d) => {
    const n = i + d;
    if (n < 0) return;
    if (n >= steps.length) { finish(); return; }
    setI(n);
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Spotlight box (clamped to viewport).
  const box = rect && {
    top: Math.max(rect.top - PAD, 4),
    left: Math.max(rect.left - PAD, 4),
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Bubble placement: below the target if there's room, else above; centered
  // when there's no target.
  let bubbleStyle;
  if (!rect) {
    bubbleStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else {
    const roomBelow = vh - (rect.top + rect.height);
    const left = Math.min(Math.max(rect.left, 12), Math.max(vw - 360, 12));
    if (roomBelow > 230) {
      bubbleStyle = { top: rect.top + rect.height + 14, left };
    } else {
      bubbleStyle = { bottom: vh - rect.top + 14, left };
    }
  }

  return (
    <div className="ptour-root" role="dialog" aria-modal="true" aria-label="Pricing walkthrough">
      {box ? (
        <div className="ptour-spot" style={box} />
      ) : (
        <div className="ptour-dim" />
      )}

      <div className="ptour-bubble" style={bubbleStyle}>
        {step.title && <h3 className="ptour-title">{step.title}</h3>}
        <div className="ptour-body">{step.body}</div>

        <div className="ptour-foot">
          <span className="ptour-count">{i + 1} / {steps.length}</span>
          <div className="ptour-btns">
            <button className="ptour-skip" onClick={finish}>Skip</button>
            {i > 0 && <button className="ptour-back" onClick={() => go(-1)}>Back</button>}
            <button className="ptour-next" onClick={() => go(1)}>
              {last ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
