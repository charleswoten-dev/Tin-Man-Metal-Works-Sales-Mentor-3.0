import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiPostSafe } from '../lib/api.js';
import TinManIcon from '../components/TinManIcon.jsx';
import './Auth.css';
import './Register.css';

// Warm rejection copy (verbatim from spec). Per the security rules, the backend
// returns a single generic rejection for ANY key failure, so the key screen
// shows ONE message regardless of reason — never revealing whether a key exists,
// is used, or is revoked.
const MSG = {
  emailNotFound:
    "Hmm, we couldn't find a purchase associated with that email. Make sure you're using the same email you bought with. If you just purchased it can take a few minutes to process — try again shortly. Still having trouble? Reply to your purchase confirmation email and we will get you sorted.",
  keyInvalid:
    "That license key doesn't look right. Double check it matches exactly what was in your welcome email. Keys look like this: TM3-XXXX-XXXX-XXXX. Need help? Check your spam folder for the welcome email from Tin Man Metal Works.",
  rateLimited: 'Too many attempts. Please wait a little while and try again.',
  generic: 'Something went wrong. Please try again in a moment.',
};

// Auto-format raw input into TM3-XXXX-XXXX-XXXX as the user types.
function formatKey(value) {
  let chars = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  // Ensure the fixed TM3 prefix so grouping lines up with the displayed format.
  if (!chars.startsWith('TM3')) {
    chars = ('TM3' + chars).slice(0, 15);
  }
  chars = chars.slice(0, 15);
  const prefix = chars.slice(0, 3);
  const rest = chars.slice(3);
  const groups = rest.match(/.{1,4}/g) || [];
  return [prefix, ...groups].join('-');
}

export default function Register() {
  const { signIn } = useAuth();
  const [step, setStep] = useState('email'); // email | key | password | success
  const [email, setEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function resetTo(next) {
    setError('');
    setStep(next);
  }

  async function handleEmail(e) {
    e.preventDefault();
    setError('');
    const value = email.trim().toLowerCase();
    if (!value) return setError('Please enter your email.');
    setBusy(true);
    try {
      const { status, data } = await apiPostSafe('/register/check-email', { email: value });
      if (status === 429) return setError(MSG.rateLimited);
      if (status >= 500 || !data) return setError(MSG.generic);
      if (data.approved) {
        setEmail(value);
        resetTo('key');
      } else {
        setError(MSG.emailNotFound);
      }
    } catch {
      setError(MSG.generic);
    } finally {
      setBusy(false);
    }
  }

  async function handleKey(e) {
    e.preventDefault();
    setError('');
    if (!licenseKey.trim()) return setError(MSG.keyInvalid);
    setBusy(true);
    try {
      const { status, data } = await apiPostSafe('/register/validate-key', {
        email,
        licenseKey: licenseKey.trim(),
      });
      if (status === 429) return setError(MSG.rateLimited);
      if (status >= 500 || !data) return setError(MSG.generic);
      if (data.valid) {
        resetTo('password');
      } else {
        setError(MSG.keyInvalid);
      }
    } catch {
      setError(MSG.generic);
    } finally {
      setBusy(false);
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords don’t match.');
    setBusy(true);
    try {
      const { status, data } = await apiPostSafe('/register/activate', {
        email,
        licenseKey: licenseKey.trim(),
        password,
      });
      if (status === 429) return setError(MSG.rateLimited);
      if (status === 409) {
        return setError(data?.error || 'An account with this email already exists. Please sign in.');
      }
      if (!data?.ok) return setError(data?.error || MSG.generic);

      // Success — show the celebration screen, then sign them in so the app
      // launches into the onboarding tour.
      setStep('success');
      setTimeout(async () => {
        try {
          await signIn(email, password);
        } catch {
          /* Session will be established on next sign-in if this hiccups. */
        }
      }, 2000);
    } catch {
      setError(MSG.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card reg-card">
        <div className="auth-brand">
          <TinManIcon size={64} className="auth-logo" />
          <h1 className="auth-title">Tin Man Metal Works</h1>
          <p className="auth-subtitle">Sales Mentor 3.0</p>
        </div>

        {step === 'email' && (
          <form onSubmit={handleEmail}>
            <h2 className="reg-heading">Activate Your Sales Mentor 3.0</h2>
            <p className="reg-sub">Enter the email address you used to purchase.</p>
            <label className="auth-label" htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              className="auth-input reg-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Check My Access'}
            </button>
            <p className="auth-switch">
              Already activated?{' '}
              <Link className="auth-link" to="/signin">Sign in</Link>
            </p>
          </form>
        )}

        {step === 'key' && (
          <form onSubmit={handleKey}>
            <h2 className="reg-heading">Enter Your License Key</h2>
            <p className="reg-sub">
              Your license key was emailed to you at purchase. It looks like TM3-XXXX-XXXX-XXXX
            </p>
            <label className="auth-label" htmlFor="reg-key">License Key</label>
            <input
              id="reg-key"
              className="auth-input reg-input reg-key-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={licenseKey}
              onChange={(e) => setLicenseKey(formatKey(e.target.value))}
              placeholder="TM3-XXXX-XXXX-XXXX"
              maxLength={18}
              autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Activate My Account'}
            </button>
            <p className="auth-switch">
              <button
                type="button"
                className="auth-link"
                onClick={() =>
                  setError(
                    "Your key is in the welcome email from Tin Man Metal Works (subject: “Your Tin Man Metal Works Sales Mentor 3.0 is Ready!”). Check your spam folder if you can't find it."
                  )
                }
              >
                Can&apos;t find your key?
              </button>
            </p>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={handlePassword}>
            <h2 className="reg-heading">Almost There!</h2>
            <p className="reg-sub">Create a password to finish setting up your account.</p>
            <label className="auth-label" htmlFor="reg-pw">Password</label>
            <input
              id="reg-pw"
              className="auth-input reg-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
            />
            <label className="auth-label" htmlFor="reg-pw2">Confirm Password</label>
            <input
              id="reg-pw2"
              className="auth-input reg-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create My Account'}
            </button>
          </form>
        )}

        {step === 'success' && (
          <div className="reg-success">
            <div className="reg-success-glow">
              <TinManIcon size={84} />
            </div>
            <h2 className="reg-heading reg-success-title">You&apos;re In!</h2>
            <p className="reg-sub">Setting up your workspace…</p>
          </div>
        )}
      </div>
    </div>
  );
}
