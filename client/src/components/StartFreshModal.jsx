import { useState } from 'react';
import { RefreshIcon } from './Icons.jsx';
import './StartFreshModal.css';

// Hard reset confirmation. Spells out exactly what gets erased so there are no
// surprises — this wipes the user's data back to a brand-new account.
export default function StartFreshModal({ onConfirm, onCancel }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setError('');
    setWorking(true);
    const ok = await onConfirm();
    if (!ok) {
      setWorking(false);
      setError("Something went wrong resetting your account. Please try again.");
    }
    // On success the app reloads, so no need to clear the working state.
  }

  return (
    <div className="sf-root" role="dialog" aria-modal="true" aria-label="Start fresh">
      <div className="sf-modal">
        <div className="sf-icon"><RefreshIcon width={26} height={26} /></div>
        <h2 className="sf-title">Start fresh?</h2>
        <p className="sf-lede">
          This clears your slate and takes you back to a brand-new start. We'll walk through your
          welcome questions and quick tour again.
        </p>

        <div className="sf-list-label">This will permanently erase:</div>
        <ul className="sf-list">
          <li>Your entire chat history with the Tin Man</li>
          <li>Everything in My Saves</li>
          <li>Your Yellow Brick Road progress</li>
          <li>Your posts on the Win Wall</li>
          <li>Your onboarding answers and chosen niche</li>
        </ul>
        <p className="sf-keep">Your account stays, and any API key you connected is kept.</p>

        {error && <div className="sf-error">{error}</div>}

        <div className="sf-actions">
          <button className="sf-btn ghost" onClick={onCancel} disabled={working}>
            Cancel
          </button>
          <button className="sf-btn danger" onClick={confirm} disabled={working}>
            {working ? 'Resetting…' : 'Yes, start fresh'}
          </button>
        </div>
      </div>
    </div>
  );
}
