import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import TinManIcon from '../components/TinManIcon.jsx';
import './Auth.css';

// Sign-in only. New accounts are created exclusively through the license
// activation flow (/register) so every account is tied to a valid license.
export default function Auth() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await signIn(email.trim(), password);
      if (err) throw err;
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <TinManIcon size={64} className="auth-logo" />
          <h1 className="auth-title">Tin Man Metal Works</h1>
          <p className="auth-subtitle">Sales Mentor 3.0</p>
        </div>

        <label className="auth-label" htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          className="auth-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        <label className="auth-label" htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          className="auth-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
        />

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : 'Sign In'}
        </button>

        <p className="auth-switch">
          Have a purchase to activate?{' '}
          <Link className="auth-link" to="/register">Activate it here</Link>
        </p>
      </form>
    </div>
  );
}
