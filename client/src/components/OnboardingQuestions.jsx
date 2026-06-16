import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { NICHES } from '../lib/niches.js';
import TinManIcon from './TinManIcon.jsx';
import './OnboardingQuestions.css';

// The one-time onboarding interview. Mirrors the 8 questions in the system
// prompt (plus a niche pick) so the bot can personalize every future reply.
// Answers save to the profile and flip onboarding_completed.
const STEPS = [
  { type: 'intro' },
  {
    key: 'name',
    type: 'text',
    q: "First things first — what's your name?",
    placeholder: 'Your name',
  },
  {
    key: 'plasma_work',
    type: 'textarea',
    q: 'What kind of CNC plasma work are you doing?',
    placeholder: 'e.g. custom signs, ranch decor, automotive cutouts…',
  },
  {
    key: 'time_in_business',
    type: 'choice',
    q: 'How long have you been running your plasma business?',
    options: ['Just getting started', 'Less than a year', '1–3 years', '3+ years'],
  },
  {
    key: 'work_status',
    type: 'choice',
    q: 'Are you running this full time, or still working a day job?',
    options: ['Full time', 'Side hustle / day job', 'Just getting it off the ground'],
  },
  {
    key: 'monthly_revenue',
    type: 'choice',
    q: 'Roughly what are you bringing in per month right now?',
    options: ['Not selling yet', 'Under $1k', '$1k–$5k', '$5k–$10k', '$10k+'],
  },
  {
    key: 'best_products',
    type: 'textarea',
    q: 'What products or pieces sell the best for you?',
    placeholder: 'e.g. monogram signs, Jeep grille inserts, memorial pieces…',
  },
  {
    key: 'best_customers',
    type: 'textarea',
    q: 'Who are your best customers?',
    placeholder: 'e.g. ranchers, Jeep owners, local businesses…',
  },
  {
    key: 'biggest_struggle',
    type: 'textarea',
    q: "What's your single biggest struggle right now?",
    placeholder: 'e.g. finding customers, pricing my work, closing sales…',
  },
  {
    key: 'niche',
    type: 'niche',
    q: 'Last one — is there a niche you want to focus on?',
  },
  { type: 'done' },
];

export default function OnboardingQuestions({ onFinish }) {
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = STEPS[step];
  const total = STEPS.length;
  const firstName = (answers.name || '').trim().split(/\s+/)[0];

  function set(key, value) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function next() {
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  // Persist everything answered and mark onboarding done. Empty answers are
  // simply left null — the bot handles a sparse profile gracefully.
  async function complete() {
    setError('');
    setSaving(true);
    const payload = { onboarding_completed: true };
    for (const s of STEPS) {
      if (s.key) {
        const v = (answers[s.key] ?? '').toString().trim();
        payload[s.key] = v || null;
      }
    }
    const { error: e } = await supabase.from('profiles').update(payload).eq('id', user.id);
    setSaving(false);
    if (e) {
      setError("Couldn't save your answers. Please try again.");
      return;
    }
    await refreshProfile?.();
    onFinish?.();
  }

  // Skip still marks onboarding complete so it never nags again; saves whatever
  // was filled in so far.
  async function skip() {
    await complete();
  }

  const pct = Math.round((step / (total - 1)) * 100);

  return (
    <div className="onb-root" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="onb-card">
        {current.type !== 'intro' && current.type !== 'done' && (
          <div className="onb-progress">
            <div className="onb-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}

        {current.type === 'intro' && (
          <div className="onb-centered">
            <TinManIcon size={64} />
            <h2 className="onb-title">Welcome to the Tin Man Sales Mentor</h2>
            <p className="onb-lede">
              I'm your personal sales coach — like having Charles in your corner 24/7. Before we dive
              in, let me get to know you and your business so every bit of advice is built around YOUR
              situation. Takes about a minute.
            </p>
            <button className="onb-btn primary lg" onClick={next}>
              Let's get started
            </button>
            <button className="onb-skip" onClick={skip} disabled={saving}>
              Skip for now
            </button>
          </div>
        )}

        {current.type === 'text' && (
          <div className="onb-step">
            <span className="onb-step-count">Question {step} of {total - 2}</span>
            <h3 className="onb-q">{current.q}</h3>
            <input
              className="onb-input"
              autoFocus
              value={answers[current.key] || ''}
              placeholder={current.placeholder}
              onChange={(e) => set(current.key, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
            />
          </div>
        )}

        {current.type === 'textarea' && (
          <div className="onb-step">
            <span className="onb-step-count">Question {step} of {total - 2}</span>
            <h3 className="onb-q">{current.q}</h3>
            <textarea
              className="onb-input onb-textarea"
              autoFocus
              rows={3}
              value={answers[current.key] || ''}
              placeholder={current.placeholder}
              onChange={(e) => set(current.key, e.target.value)}
            />
          </div>
        )}

        {current.type === 'choice' && (
          <div className="onb-step">
            <span className="onb-step-count">Question {step} of {total - 2}</span>
            <h3 className="onb-q">{current.q}</h3>
            <div className="onb-choices">
              {current.options.map((opt) => (
                <button
                  key={opt}
                  className={'onb-choice' + (answers[current.key] === opt ? ' selected' : '')}
                  onClick={() => { set(current.key, opt); }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {current.type === 'niche' && (
          <div className="onb-step">
            <span className="onb-step-count">Question {step} of {total - 2}</span>
            <h3 className="onb-q">{current.q}</h3>
            <div className="onb-niches">
              {NICHES.map((n) => (
                <button
                  key={n.id}
                  className={'onb-niche' + (answers.niche === n.title ? ' selected' : '')}
                  onClick={() => set('niche', n.title)}
                >
                  <span className="onb-niche-emoji">{n.emoji}</span>
                  {n.title}
                </button>
              ))}
              <button
                className={'onb-niche unsure' + (answers.niche === '' && answers.niche !== undefined ? ' selected' : '')}
                onClick={() => set('niche', '')}
              >
                <span className="onb-niche-emoji">🤔</span>
                Not sure yet — coach me on it
              </button>
            </div>
          </div>
        )}

        {current.type === 'done' && (
          <div className="onb-centered">
            <TinManIcon size={64} />
            <h2 className="onb-title">
              {firstName ? `Perfect, ${firstName}!` : 'Perfect!'}
            </h2>
            <p className="onb-lede">
              I've got everything I need to be a really useful coach for you. From here on, every
              conversation is built around YOUR business, YOUR niche, and YOUR goals.
            </p>
            {error && <div className="onb-error">{error}</div>}
            <button className="onb-btn primary lg" onClick={complete} disabled={saving}>
              {saving ? 'Saving…' : "Let's get to work"}
            </button>
          </div>
        )}

        {current.type !== 'intro' && current.type !== 'done' && (
          <div className="onb-foot">
            <button className="onb-btn ghost" onClick={back}>Back</button>
            <button className="onb-btn primary" onClick={next}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
