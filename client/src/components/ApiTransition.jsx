import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { getTransitionState, FLAG_FOR_STATE } from '../lib/apiTransition.js';
import TinManIcon from './TinManIcon.jsx';
import './ApiTransition.css';

export default function ApiTransition() {
  const { user, profile, refreshProfile } = useAuth();
  const [openTutorial, setOpenTutorial] = useState(false);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const state = getTransitionState(profile);
  if (state === 'none' && !openTutorial) return null;

  const showTutorial = state === 'tutorial' || openTutorial;

  async function update(patch) {
    if (!user?.id) return false;
    const { error: e } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (!e) await refreshProfile?.();
    return !e;
  }

  // Acknowledge a soft heads-up — flips the matching notified flag so it won't
  // nag again before the next milestone.
  async function dismissBanner() {
    const flag = FLAG_FOR_STATE[state];
    if (flag) await update({ [flag]: true });
  }

  // Connecting a key ends the whole transition for good.
  async function saveKey() {
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Paste your API key to connect it.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await update({ anthropic_api_key: trimmed, seen_api_transition: true });
    setSaving(false);
    if (!ok) {
      setError("Couldn't save your key. Please try again.");
      return;
    }
    setOpenTutorial(false);
  }

  // "I'll do this later" — if the walkthrough was actually due (day 90), mark it
  // seen so it doesn't auto-pop; if they only peeked early from a banner, just
  // close it and quiet that banner.
  async function later() {
    if (state === 'tutorial') {
      await update({ seen_api_transition: true });
    } else {
      const flag = FLAG_FOR_STATE[state];
      if (flag) await update({ [flag]: true });
      setOpenTutorial(false);
    }
  }

  if (showTutorial) {
    return (
      <div className="apit-root" role="dialog" aria-modal="true" aria-label="Connect your API key">
        <div className="apit-modal">
          <div className="apit-modal-head">
            <TinManIcon size={44} />
            <h2>Let's connect your own API key</h2>
          </div>
          <p className="apit-lede">
            Up to now I've been running on a shared key. To keep your coaching going strong — with
            no interruptions and full control in your hands — let's plug in your very own Anthropic
            API key. It only takes a couple of minutes, and you'll only ever do this once.
          </p>

          <ol className="apit-steps">
            <li>
              Head to <span className="apit-mono">console.anthropic.com</span> and sign in (or create
              a free account).
            </li>
            <li>Add a payment method under <strong>Billing</strong> — usage is just pennies per chat.</li>
            <li>
              Open <strong>API Keys</strong>, click <strong>Create Key</strong>, and copy the key it
              gives you.
            </li>
            <li>Paste it below and hit connect — that's it.</li>
          </ol>

          <input
            className="apit-input"
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          {error && <div className="apit-error">{error}</div>}

          <div className="apit-actions">
            <button className="apit-link" onClick={later} disabled={saving}>
              I'll do this later
            </button>
            <button className="apit-btn" onClick={saveKey} disabled={saving}>
              {saving ? 'Connecting…' : 'Save & connect'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Otherwise it's one of the gentle heads-up banners (day 80 / day 87).
  const isSecond = state === 'notify87';
  return (
    <div className="apit-banner">
      <span className="apit-banner-icon">🔧</span>
      <p className="apit-banner-text">
        {isSecond
          ? "Almost time to connect your own API key — it keeps your coach running smoothly and puts you fully in control. Whenever you're ready, I'll walk you through it."
          : "Quick heads-up: before long you'll connect your own API key so your Tin Man keeps coaching without a hitch. It's a quick, one-time setup and I'll guide you every step."}
      </p>
      <div className="apit-banner-actions">
        <button className="apit-banner-btn" onClick={() => setOpenTutorial(true)}>
          Set it up now
        </button>
        <button className="apit-banner-dismiss" onClick={dismissBanner} aria-label="Dismiss">
          Got it
        </button>
      </div>
    </div>
  );
}
