import { useEffect, useLayoutEffect, useState } from 'react';
import TinManIcon from './TinManIcon.jsx';
import './OnboardingTour.css';

// The guided walkthrough shown to first-time users. Each step either spotlights
// a real element (by CSS selector) or shows a centered card (target: null).
// Exported so callers can replay it, and so other tours (e.g. Pricing) can
// reuse the same component with a different step list.
export const MENU_TOUR_STEPS = [
  {
    target: null,
    title: 'Welcome to your Tin Man Sales Mentor',
    body: "I'm your CNC plasma sales coach. Let me give you a quick tour so you know where everything lives.",
  },
  {
    target: 'a[href="/chat"]',
    title: 'Chat with your coach',
    body: 'Ask me anything — pricing, ads, offers, guarantees, or finding your niche. This is home base.',
  },
  {
    target: 'a[href="/progress"]',
    title: 'My Projects',
    body: 'Your Yellow Brick Road — 17 steps to a thriving plasma business. Each project tracks its own progress; check steps off as you go. And finishing a project unlocks something big…',
  },
  {
    target: null,
    title: 'Done-for-you marketing',
    body: "Once all 17 steps of a project are done, I'll write your marketing FOR you — a full landing page, a 7-part follow-up email sequence, a sales ad, and 3 lead magnet ideas (with a finished example of each). One click each, it saves into your project, and you can download any of it as a clean PDF.",
  },
  {
    target: null,
    title: 'See your landing page as a real page',
    body: 'On the landing page, tap "Preview as a landing page" and I\'ll turn your copy into a real, styled funnel-page mockup — flip between color styles and download it as an image or PDF to build your actual page from.',
  },
  {
    target: 'a[href="/saves"]',
    title: 'My Saves',
    body: 'Save any reply — ad copy, emails, guarantees — and find it all here, organized by type.',
  },
  {
    target: 'a[href="/niche-library"]',
    title: 'Niche Library',
    body: 'Seventeen proven plasma niches to spark ideas, each with one-tap coaching.',
  },
  {
    target: 'a[href="/win-wall"]',
    title: 'Win Wall',
    body: 'Share your wins and get fired up by what other shop owners are landing.',
  },
  {
    target: 'a[href="/pricing"]',
    title: 'Pricing & Quotes',
    body: "Build your true shop rate once, then quote every job from your real costs — so every price actually makes you money. It has its own quick tour when you open it.",
  },
  {
    target: 'a[href="/settings"]',
    title: 'Settings',
    body: 'Read-aloud voice, your account, your API key, and replaying this tour all live here.',
  },
  {
    target: '[data-tour="view-chat"]',
    title: 'Chat view',
    body: 'Up top right, the Chat tab keeps you talking to your coach about whichever project is picked in the dropdown beside it.',
  },
  {
    target: '[data-tour="view-progress"]',
    title: 'Progress view',
    body: "Right next to it, the Progress tab flips to that same project's 17-step roadmap. Same project, two views — one click apart.",
  },
  {
    target: '[data-tour="replay-tour"]',
    title: 'Replay this walkthrough',
    body: "Forget where something lives? Tap Replay walkthrough up here anytime to run this tour again.",
  },
  {
    target: null,
    title: "You're all set",
    body: "That's the whole shop. Let's get to work growing your plasma business.",
    final: true,
  },
];

const PAD = 8; // breathing room around the spotlighted element

export default function OnboardingTour({ steps = MENU_TOUR_STEPS, onFinish, ariaLabel = 'App tour' }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const current = steps[step];
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
    if (step >= steps.length - 1) onFinish();
    else setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  // Position the tooltip: centered when there's no target, otherwise beside the
  // spotlighted element. Prefer the right; if there isn't room (e.g. top-right
  // toolbar buttons) flip to the left. Always clamped to stay on screen.
  const TIP_W = 320; // matches .tour-tip width in CSS
  let tipStyle;
  if (isCentered || !rect) {
    tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else {
    const top = Math.min(
      Math.max(rect.top + rect.height / 2 - 70, 16),
      window.innerHeight - 200
    );
    let left = rect.left + rect.width + 22; // prefer right of the target
    if (left + TIP_W > window.innerWidth - 16) {
      left = rect.left - TIP_W - 22; // no room on the right → place on the left
    }
    left = Math.max(16, Math.min(left, window.innerWidth - TIP_W - 16));
    tipStyle = { top: `${top}px`, left: `${left}px` };
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
    <div className="tour-root" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      {spotStyle ? (
        <div className="tour-spot" style={spotStyle} />
      ) : (
        <div className="tour-dim" />
      )}

      <div className={'tour-tip' + (isCentered ? ' centered' : '')} style={tipStyle}>
        {isCentered && <TinManIcon size={48} className="tour-tip-icon" />}
        <div className="tour-tip-head">
          <span className="tour-step-count">
            {step + 1} / {steps.length}
          </span>
          <button className="tour-skip" onClick={onFinish}>
            Skip tour
          </button>
        </div>
        <h3 className="tour-tip-title">{current.title}</h3>
        <p className="tour-tip-body">{current.body}</p>

        <div className="tour-dots">
          {steps.map((_, i) => (
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
