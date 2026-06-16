import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { SAVE_TYPES, SAVE_TYPE_LABELS } from '../lib/saveTypes.js';
import { CopyIcon, CheckIcon, BookmarkIcon } from '../components/Icons.jsx';
import './Saves.css';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SaveCard({ item, onDelete }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="save-card">
      <div className="save-card-head">
        <span className="save-badge">{SAVE_TYPE_LABELS[item.type] || item.type}</span>
        <span className="save-date">{formatDate(item.created_at)}</span>
      </div>
      <div className="save-content md">
        <ReactMarkdown>{item.content}</ReactMarkdown>
      </div>
      <div className="save-card-actions">
        <button className="save-action" onClick={handleCopy}>
          {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button className="save-action danger" onClick={() => onDelete(item.id)}>
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}

export default function Saves() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase
      .from('saves')
      .select('id, content, type, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setItems(data || []);
        setLoading(false);
      });
  }, [user?.id]);

  async function handleDelete(id) {
    setItems((prev) => prev.filter((s) => s.id !== id));
    await supabase.from('saves').delete().eq('id', id);
  }

  // Only offer filters for types the user actually has.
  const presentTypes = useMemo(() => {
    const set = new Set(items.map((s) => s.type));
    return SAVE_TYPES.filter((t) => set.has(t.value));
  }, [items]);

  const visible = filter === 'all' ? items : items.filter((s) => s.type === filter);

  return (
    <div className="saves-view">
      <header className="view-header">
        <div>
          <h1>My Saves</h1>
          <p>Everything you've saved from the Tin Man, in one place.</p>
        </div>
        {items.length > 0 && <span className="saves-count">{items.length}</span>}
      </header>

      {items.length > 0 && (
        <div className="saves-filters">
          <button
            className={'saves-filter' + (filter === 'all' ? ' active' : '')}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          {presentTypes.map((t) => (
            <button
              key={t.value}
              className={'saves-filter' + (filter === t.value ? ' active' : '')}
              onClick={() => setFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="saves-body">
        {loading ? (
          <div className="saves-empty">Loading your saves…</div>
        ) : items.length === 0 ? (
          <div className="saves-empty">
            <BookmarkIcon width={40} height={40} />
            <h2>Nothing saved yet</h2>
            <p>When the Tin Man writes something good, hit <strong>Save</strong> on the message and it'll show up here.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="saves-empty">No saves in this category.</div>
        ) : (
          <div className="saves-list">
            {visible.map((item) => (
              <SaveCard key={item.id} item={item} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
