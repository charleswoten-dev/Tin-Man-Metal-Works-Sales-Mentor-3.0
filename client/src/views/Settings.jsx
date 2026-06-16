import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { NICHES } from '../lib/niches.js';
import { SpeakerOnIcon, SpeakerOffIcon, LogoutIcon } from '../components/Icons.jsx';
import './Settings.css';

const TIME_OPTIONS = ['Just getting started', 'Less than a year', '1–3 years', '3+ years'];
const WORK_OPTIONS = ['Full time', 'Side hustle / day job', 'Just getting it off the ground'];
const REVENUE_OPTIONS = ['Not selling yet', 'Under $1k', '$1k–$5k', '$5k–$10k', '$10k+'];

const PROFILE_FIELDS = [
  'name',
  'plasma_work',
  'time_in_business',
  'work_status',
  'monthly_revenue',
  'best_products',
  'best_customers',
  'biggest_struggle',
  'niche',
];

// Builds a <select>'s options, making sure a previously-saved custom value
// still shows up even if it isn't one of the presets.
function withCurrent(options, value) {
  if (value && !options.includes(value)) return [value, ...options];
  return options;
}

export default function Settings() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [voice, setVoice] = useState(false);

  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  // Seed the editable form from the loaded profile.
  useEffect(() => {
    if (!profile) return;
    const seed = {};
    for (const f of PROFILE_FIELDS) seed[f] = profile[f] || '';
    setForm(seed);
    setVoice(Boolean(profile.voice_enabled));
  }, [profile?.id]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveProfile() {
    setSavingProfile(true);
    const patch = {};
    for (const f of PROFILE_FIELDS) patch[f] = (form[f] ?? '').trim() || null;
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    setSavingProfile(false);
    if (!error) {
      await refreshProfile?.();
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1800);
    }
  }

  async function toggleVoice() {
    const next = !voice;
    setVoice(next);
    await supabase.from('profiles').update({ voice_enabled: next }).eq('id', user.id);
    refreshProfile?.();
  }

  const hasKey = Boolean(profile?.anthropic_api_key);
  const maskedKey = hasKey
    ? `••••••••••••${String(profile.anthropic_api_key).slice(-4)}`
    : '';

  async function connectKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setKeyBusy(true);
    await supabase
      .from('profiles')
      .update({ anthropic_api_key: trimmed, seen_api_transition: true })
      .eq('id', user.id);
    setKeyBusy(false);
    setKeyInput('');
    setEditingKey(false);
    refreshProfile?.();
  }

  async function removeKey() {
    setKeyBusy(true);
    await supabase.from('profiles').update({ anthropic_api_key: null }).eq('id', user.id);
    setKeyBusy(false);
    refreshProfile?.();
  }

  async function replayTour() {
    await supabase.from('profiles').update({ tour_completed: false }).eq('id', user.id);
    await refreshProfile?.();
    navigate('/chat');
  }

  return (
    <div className="settings-view">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>Update your business details, voice, and account.</p>
      </header>

      <div className="settings-body">
        {/* Profile */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Your business</h2>
            <p>The Tin Man uses these to tailor every piece of advice to your shop.</p>
          </div>

          <label className="settings-field">
            <span>Name</span>
            <input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>What kind of CNC plasma work you do</span>
            <textarea rows={2} value={form.plasma_work || ''} onChange={(e) => set('plasma_work', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>Time in business</span>
            <select value={form.time_in_business || ''} onChange={(e) => set('time_in_business', e.target.value)}>
              <option value="">—</option>
              {withCurrent(TIME_OPTIONS, form.time_in_business).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Full time or day job</span>
            <select value={form.work_status || ''} onChange={(e) => set('work_status', e.target.value)}>
              <option value="">—</option>
              {withCurrent(WORK_OPTIONS, form.work_status).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Monthly revenue</span>
            <select value={form.monthly_revenue || ''} onChange={(e) => set('monthly_revenue', e.target.value)}>
              <option value="">—</option>
              {withCurrent(REVENUE_OPTIONS, form.monthly_revenue).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Best-selling products</span>
            <textarea rows={2} value={form.best_products || ''} onChange={(e) => set('best_products', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>Best customers</span>
            <textarea rows={2} value={form.best_customers || ''} onChange={(e) => set('best_customers', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>Biggest struggle</span>
            <textarea rows={2} value={form.biggest_struggle || ''} onChange={(e) => set('biggest_struggle', e.target.value)} />
          </label>

          <label className="settings-field">
            <span>Niche</span>
            <select value={form.niche || ''} onChange={(e) => set('niche', e.target.value)}>
              <option value="">Not sure yet</option>
              {NICHES.some((n) => n.title === form.niche) ? null : form.niche ? (
                <option value={form.niche}>{form.niche}</option>
              ) : null}
              {NICHES.map((n) => (
                <option key={n.id} value={n.title}>{n.title}</option>
              ))}
            </select>
          </label>

          <div className="settings-save-row">
            <button className="settings-btn primary" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving…' : profileSaved ? 'Saved ✓' : 'Save changes'}
            </button>
          </div>
        </section>

        {/* Voice */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Read aloud</h2>
            <p>Have the Tin Man speak its replies out loud.</p>
          </div>
          <div className="settings-toggle-row">
            <span className="settings-toggle-label">
              {voice ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
              Read replies aloud
            </span>
            <button
              className={'settings-switch' + (voice ? ' on' : '')}
              onClick={toggleVoice}
              role="switch"
              aria-checked={voice}
              aria-label="Toggle read aloud"
            >
              <span className="settings-switch-knob" />
            </button>
          </div>
        </section>

        {/* API key */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>API key</h2>
            <p>Connect your own Anthropic key so your coaching keeps running, fully under your control.</p>
          </div>

          {hasKey && !editingKey ? (
            <>
              <div className="settings-key-status">
                <span className="settings-key-dot connected" />
                Your own key is connected
                <code className="settings-key-mask">{maskedKey}</code>
              </div>
              <div className="settings-key-actions">
                <button className="settings-btn ghost" onClick={() => setEditingKey(true)} disabled={keyBusy}>
                  Update key
                </button>
                <button className="settings-btn danger-ghost" onClick={removeKey} disabled={keyBusy}>
                  Remove
                </button>
              </div>
            </>
          ) : (
            <>
              {!hasKey && !editingKey && (
                <div className="settings-key-status">
                  <span className="settings-key-dot shared" />
                  Currently using the shared key
                </div>
              )}
              <input
                className="settings-key-input"
                type="password"
                placeholder="sk-ant-..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoComplete="off"
              />
              <div className="settings-key-actions">
                <button className="settings-btn primary" onClick={connectKey} disabled={keyBusy || !keyInput.trim()}>
                  {keyBusy ? 'Saving…' : 'Connect key'}
                </button>
                {editingKey && (
                  <button className="settings-btn ghost" onClick={() => { setEditingKey(false); setKeyInput(''); }} disabled={keyBusy}>
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {/* Account */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Account</h2>
          </div>
          <div className="settings-field">
            <span>Email</span>
            <div className="settings-readonly">{user?.email || '—'}</div>
          </div>
          <div className="settings-account-actions">
            <button className="settings-btn ghost" onClick={replayTour}>
              Replay app tour
            </button>
            <button className="settings-btn ghost" onClick={signOut}>
              <LogoutIcon width={16} height={16} /> Sign out
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
