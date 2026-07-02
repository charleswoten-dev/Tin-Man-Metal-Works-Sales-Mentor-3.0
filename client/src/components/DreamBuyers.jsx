import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import './DreamBuyers.css';

// A user-level library of reusable "dream buyer" avatars, shown in the sidebar.
// Independent of any project — save one once, then drop it into any walkthrough.
export default function DreamBuyers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = () => {
      supabase
        .from('avatars')
        .select('id, name, content')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (cancelled) return;
          setAvatars(data || []);
          setLoaded(true);
        });
    };
    load();
    window.addEventListener('tinman:avatars-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('tinman:avatars-changed', load);
    };
  }, [user?.id]);

  // Drop the avatar into the chat as the answer to Step 1 / Step 7.
  function useInWalkthrough(a) {
    setView(null);
    const msg =
      `I want to use my saved dream buyer for this product. Treat this as my answer to ` +
      `Step 1 (Find Your Dream Buyer) and Step 7 (Dream Buyer Avatar) — confirm it back to me ` +
      `and keep going with the walkthrough from there:\n\n**${a.name}**\n\n${a.content}`;
    navigate('/chat', { state: { autosend: msg } });
  }

  async function remove(a) {
    if (!window.confirm(`Delete the dream buyer "${a.name}"? This can't be undone.`)) return;
    setAvatars((prev) => prev.filter((x) => x.id !== a.id));
    setView(null);
    await supabase.from('avatars').delete().eq('id', a.id);
  }

  return (
    <>
      <div className="nav-section-label db-head">
        <span>My Dream Buyers</span>
        <button className="db-add" onClick={() => setCreating(true)} title="Save a new dream buyer" aria-label="New dream buyer">+</button>
      </div>

      {loaded && avatars.length === 0 ? (
        <div className="db-empty">Save a dream buyer here to reuse across every project.</div>
      ) : (
        <ul className="db-list">
          {avatars.map((a) => (
            <li key={a.id}>
              <button className="db-item" onClick={() => setView(a)} title={a.name}>
                <span className="db-dot" aria-hidden="true" />
                <span className="db-name">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view && (
        <AvatarViewModal avatar={view} onClose={() => setView(null)} onUse={() => useInWalkthrough(view)} onDelete={() => remove(view)} />
      )}
      {creating && <AvatarCreateModal onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />}
    </>
  );
}

function AvatarViewModal({ avatar, onClose, onUse, onDelete }) {
  return createPortal(
    <div className="db-overlay" onClick={onClose}>
      <div className="db-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={avatar.name}>
        <header className="db-modal-head">
          <div>
            <h3>🎯 {avatar.name}</h3>
            <span className="db-modal-sub">Saved dream buyer</span>
          </div>
          <button className="db-x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="db-modal-body md">
          <ReactMarkdown>{avatar.content}</ReactMarkdown>
        </div>
        <footer className="db-modal-actions">
          <button className="db-btn ghost danger" onClick={onDelete}>Delete</button>
          <div className="db-modal-right">
            <button className="db-btn" onClick={onClose}>Close</button>
            <button className="db-btn primary" onClick={onUse}>Use in a walkthrough →</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function AvatarCreateModal({ onClose, onSaved }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = name.trim();
    const c = content.trim();
    if (!n || !c || saving || !user?.id) return;
    setSaving(true);
    const { error } = await supabase.from('avatars').insert({ user_id: user.id, name: n, content: c });
    setSaving(false);
    if (!error) {
      window.dispatchEvent(new Event('tinman:avatars-changed'));
      onSaved();
    }
  }

  return createPortal(
    <div className="db-overlay" onClick={onClose}>
      <div className="db-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New dream buyer">
        <header className="db-modal-head">
          <div>
            <h3>🎯 Save a Dream Buyer</h3>
            <span className="db-modal-sub">Reuse it across any project</span>
          </div>
          <button className="db-x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="db-modal-body">
          <label className="db-label">Name it</label>
          <input
            className="db-input"
            autoFocus
            value={name}
            placeholder="e.g. Ranchers, Jeep Owners, Backyard Hosts"
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="db-label">The dream buyer</label>
          <textarea
            className="db-input db-textarea"
            rows={8}
            value={content}
            placeholder="Who they are, what they want, their fears and objections, where they hang out… Paste what the coach wrote in a walkthrough, or write your own."
            onChange={(e) => setContent(e.target.value)}
          />
          <p className="db-hint">Tip: when the coach builds a dream buyer in a walkthrough, copy it and save it here to reuse.</p>
        </div>
        <footer className="db-modal-actions">
          <span />
          <div className="db-modal-right">
            <button className="db-btn" onClick={onClose}>Cancel</button>
            <button className="db-btn primary" onClick={save} disabled={!name.trim() || !content.trim() || saving}>
              {saving ? 'Saving…' : 'Save dream buyer'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
