import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { WinsIcon } from '../components/Icons.jsx';
import './WinWall.css';

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

export default function WinWall() {
  const { user, profile } = useAuth();
  const [wins, setWins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const authorName = profile?.name || user?.email?.split('@')[0] || 'A fabricator';

  useEffect(() => {
    supabase
      .from('wins')
      .select('id, name, content, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setWins(data || []);
        setLoading(false);
      });
  }, []);

  async function postWin() {
    const content = draft.trim();
    if (!content || posting || !user?.id) return;
    setError('');
    setPosting(true);

    const { data, error: postErr } = await supabase
      .from('wins')
      .insert({ user_id: user.id, name: authorName, content })
      .select('id, name, content, created_at, user_id')
      .single();

    if (postErr) {
      setError("Couldn't post your win just now. Please try again.");
      setPosting(false);
      return;
    }
    setWins((prev) => [data, ...prev]);
    setDraft('');
    setPosting(false);
  }

  return (
    <div className="winwall-view">
      <header className="view-header">
        <div>
          <h1>Win Wall</h1>
          <p>Celebrate your wins and cheer on the rest of the shop owners walking the road.</p>
        </div>
      </header>

      <div className="winwall-body">
        <div className="win-composer">
          <textarea
            className="win-input"
            placeholder="Share a win — a sale you closed, a milestone you hit, anything worth celebrating…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={600}
          />
          <div className="win-composer-foot">
            <span className="win-as">Posting as <strong>{authorName}</strong></span>
            <button className="win-post-btn" onClick={postWin} disabled={posting || !draft.trim()}>
              {posting ? 'Posting…' : 'Post Win'}
            </button>
          </div>
        </div>

        {error && <div className="win-error">{error}</div>}

        {loading ? (
          <div className="winwall-empty">Loading the wins…</div>
        ) : wins.length === 0 ? (
          <div className="winwall-empty">
            <WinsIcon width={40} height={40} />
            <h2>No wins posted yet</h2>
            <p>Be the first to put one on the board. Every win counts — big or small.</p>
          </div>
        ) : (
          <div className="win-list">
            {wins.map((w) => (
              <div key={w.id} className={'win-card' + (w.user_id === user?.id ? ' mine' : '')}>
                <div className="win-avatar">{initials(w.name)}</div>
                <div className="win-card-body">
                  <div className="win-card-head">
                    <span className="win-name">{w.name}</span>
                    <span className="win-time">{timeAgo(w.created_at)}</span>
                  </div>
                  <p className="win-content">{w.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
