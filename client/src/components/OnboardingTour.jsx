import { useEffect, useLayoutEffect, useState } from 'react';
import TinManIcon from './TinManIcon.jsx';
import './OnboardingTour.css';

// The guided walkthrough shown to first-time users. Each step either spotlights
// a real element (by CSS selector) or shows a centered card (target: null).
const STEPS = [
  {
    target: null,
    title: 'Welcome to your Tin Man Sales Mentor',
    body: "I'm your CNC plasma sales coach. Let me give you a 20-second tour so you know where everything lives.",
  },
  {
    target: 'a[href="/chat"]',
    title: 'Chat with your coach',
    body: 'Ask me anything — pricing, ads, offers, guarantees, or finding your niche. This is home base.',
  },
  {
    target: 'a[href="/progress"]',
    title: 'My Progress',
    body: 'Your Yellow Brick Road — 17 steps to a thriving plasma business. Check them off as you go.',
  },
  {
    target: 'a[href="/saves"]',
    title: 'My Saves',
    body: 'Save any reply — ad copy, emails, guarantees — and find it all here, organized by type.',
  },
  {
    target: 'a[href="/niche-library"]',
    title: 'Niche Library',
    body: 'Ten proven plasma niches to spark ideas, each with one-tap coaching.',
  },
  {
    target: 'a[href="/win-wall"]',
    title: 'Win Wall',
    body: 'Share your wins and get fired up by what other shop owners are landing.',
  },
  {
    target: 'a[href="/settings"]',
    title: 'Settings',
    body: 'Read-aloud voice, your account, and preferences all live here.',
  },
  {
    target: null,
    title: "You're all set",
    body: "That's the whole shop. Let's get to work growing your plasma business.",
    final: true,
  },
];

const PAD = 8; // breathing room around the spotlighted element

export default function OnboardingTour({ onFinish }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const current = STEPS[step];
  const isCentered = !current.target;

  // Measure the spotlighted element (and re-measure on resize). Runs in a layout
  // effect so the spotlight is positioned before the browser paints.
  useLayoutEffect(() => {
    function measure() {
      if (!current.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(current.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [current.target]);

  // Let users bail with Escape.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onFinish();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFinish]);

  function next() {
    if (step >= STEPS.length - 1) onFinish();
    else setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  // Position the tooltip: centered when there's no target, otherwise just to the
  // right of the spotlighted sidebar item (clamped to stay on screen).
  let tipStyle;
  if (isCentered || !rect) {
    tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else {
    const top = Math.min(
      Math.max(rect.top + rect.height / 2 - 70, 16),
      window.innerHeight - 200
    );
    tipStyle = { top: `${top}px`, left: `${rect.left + rect.width + 22}px` };
  }

  // Spotlight box: a transparent rect with a huge box-shadow that dims everything
  // else. When there's no target we dim the whole screen instead.
  const spotStyle = rect
    ? {
        top: `${rect.top - PAD}px`,
        left: `${rect.left - PAD}px`,
        width: `${rect.width + PAD * 2}px`,
        height: `${rect.height + PAD * 2}px`,
      }
    : null;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="App tour">
      {spotStyle ? (
        <div className="tour-spot" style={spotStyle} />
      ) : (
        <div className="tour-dim" />
      )}

      <div className={'tour-tip' + (isCentered ? ' centered' : '')} style={tipStyle}>
        {isCentered && <TinManIcon size={48} className="tour-tip-icon" />}
        <div className="tour-tip-head">
          <span className="tour-step-count">
            {step + 1} / {STEPS.length}
          </span>
          <button className="tour-skip" onClick={onFinish}>
            Skip tour
          </button>
        </div>
        <h3 className="tour-tip-title">{current.title}</h3>
        <p className="tour-tip-body">{current.body}</p>

        <div className="tour-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={'tour-dot' + (i === step ? ' on' : '')} />
          ))}
        </div>

        <div className="tour-tip-foot">
          {step > 0 ? (
            <button className="tour-btn ghost" onClick={back}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button className="tour-btn primary" onClick={next}>
            {current.final ? "Let's go" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
