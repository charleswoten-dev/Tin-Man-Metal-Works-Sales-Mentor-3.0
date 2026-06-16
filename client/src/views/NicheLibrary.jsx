import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NICHES } from '../lib/niches.js';
import './NicheLibrary.css';

function NicheCard({ niche, onCoach }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'niche-card' + (open ? ' open' : '')}>
      <button className="niche-card-head" onClick={() => setOpen((o) => !o)}>
        <span className="niche-emoji">{niche.emoji}</span>
        <span className="niche-head-text">
          <span className="niche-title">{niche.title}</span>
          <span className="niche-tagline">{niche.tagline}</span>
        </span>
        <span className={'niche-chevron' + (open ? ' up' : '')}>⌄</span>
      </button>

      {open && (
        <div className="niche-detail">
          <div className="niche-field">
            <span className="niche-label">Best-selling products</span>
            <div className="niche-chips">
              {niche.products.map((p) => (
                <span key={p} className="niche-chip">{p}</span>
              ))}
            </div>
          </div>
          <div className="niche-field">
            <span className="niche-label">Who buys</span>
            <p>{niche.buyers}</p>
          </div>
          <div className="niche-field">
            <span className="niche-label">Why it works</span>
            <p>{niche.why}</p>
          </div>
          <button className="niche-coach-btn" onClick={() => onCoach(niche)}>
            Coach me on this niche
          </button>
        </div>
      )}
    </div>
  );
}

export default function NicheLibrary() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NICHES;
    return NICHES.filter((n) =>
      [n.title, n.tagline, n.buyers, n.why, ...n.products].join(' ').toLowerCase().includes(q)
    );
  }, [query]);

  function handleCoach(niche) {
    const prompt = `I want to focus on the ${niche.title} niche (${niche.products.join(', ')}). Where should I start to grow this part of my business?`;
    navigate('/chat', { state: { prefill: prompt } });
  }

  return (
    <div className="niche-view">
      <header className="view-header">
        <div>
          <h1>Niche Library</h1>
          <p>Proven plasma niches to spark ideas. Tap one to dig in, or have the Tin Man coach you on it.</p>
        </div>
      </header>

      <div className="niche-search-wrap">
        <input
          className="niche-search"
          placeholder="Search niches — signs, Jeep, memorial, business…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="niche-body">
        {filtered.length === 0 ? (
          <div className="niche-empty">No niches match "{query}". Try another keyword.</div>
        ) : (
          <div className="niche-list">
            {filtered.map((n) => (
              <NicheCard key={n.id} niche={n} onCoach={handleCoach} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
