import { useEffect, useState, useCallback } from 'react';
import {
  adminFetch,
  adminDownload,
  getAdminToken,
  setAdminToken,
  clearAdminToken,
} from '../lib/adminApi.js';
import TinManIcon from '../components/TinManIcon.jsx';
import './Admin.css';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// ── Login ─────────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { status, data } = await adminFetch('/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      if (status === 503) return setError('Admin panel is not configured yet.');
      if (!data?.token) return setError(data?.error || 'Invalid email or password.');
      setAdminToken(data.token);
      onLogin(data.email);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login-screen">
      <form className="admin-login-card" onSubmit={submit}>
        <div className="admin-login-brand">
          <TinManIcon size={56} />
          <h1>Admin Panel</h1>
          <p>Tin Man Metal Works · Sales Mentor 3.0</p>
        </div>
        <label className="admin-label">Email</label>
        <input
          className="admin-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="admin-label">Password</label>
        <input
          className="admin-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="admin-error">{error}</div>}
        <button className="admin-btn admin-btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }) {
  return (
    <div className="admin-stat-card">
      <div className={'admin-stat-value' + (accent ? ' accent' : '')}>{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch('/stats').then(({ data, ok }) => {
      if (ok && data) setStats(data);
      else setError(data?.error || 'Could not load stats.');
    });
  }, []);

  if (error) return <div className="admin-error">{error}</div>;
  if (!stats) return <div className="admin-muted">Loading…</div>;

  return (
    <div>
      <h3 className="admin-section-title">Licenses</h3>
      <div className="admin-stat-grid">
        <StatCard label="Total generated" value={stats.licenses.total} accent />
        <StatCard label="Activated" value={stats.licenses.activated} />
        <StatCard label="Pending" value={stats.licenses.pending} />
        <StatCard label="Revoked" value={stats.licenses.revoked} />
      </div>
      <h3 className="admin-section-title">Users &amp; Purchases</h3>
      <div className="admin-stat-grid">
        <StatCard label="Active users" value={stats.activeUsers} accent />
        <StatCard label="New today" value={stats.purchases.today} />
        <StatCard label="New this week" value={stats.purchases.week} />
        <StatCard label="New this month" value={stats.purchases.month} />
      </div>
    </div>
  );
}

// ── Licenses ──────────────────────────────────────────────────────────────────
function LicensesTab() {
  const [licenses, setLicenses] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [genEmail, setGenEmail] = useState('');
  const [genAutoEmail, setGenAutoEmail] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status !== 'all') params.set('status', status);
    const { data } = await adminFetch(`/licenses?${params.toString()}`);
    setLicenses(data?.licenses || []);
    setBusy(false);
  }, [search, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(e) {
    e.preventDefault();
    setNotice('');
    const { data, ok } = await adminFetch('/licenses/generate', {
      method: 'POST',
      body: {
        count: Number(genCount) || 1,
        email: genEmail.trim() || undefined,
        autoEmail: genAutoEmail,
      },
    });
    if (ok && data?.keys) {
      setNotice(`Generated ${data.keys.length} key(s): ${data.keys.join(', ')}`);
      setGenEmail('');
      setGenCount(1);
      setGenAutoEmail(false);
      load();
    } else {
      setNotice(data?.error || 'Generation failed.');
    }
  }

  async function setRevoked(id, revoke) {
    await adminFetch(`/licenses/${id}/${revoke ? 'revoke' : 'reinstate'}`, { method: 'POST' });
    load();
  }

  return (
    <div>
      <form className="admin-panel admin-generate" onSubmit={generate}>
        <h3 className="admin-section-title">Generate Licenses</h3>
        <div className="admin-row">
          <input
            className="admin-input"
            type="number"
            min="1"
            max="100"
            value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
            style={{ width: 90 }}
            aria-label="Number of keys"
          />
          <input
            className="admin-input"
            type="email"
            placeholder="Bind to email (optional)"
            value={genEmail}
            onChange={(e) => setGenEmail(e.target.value)}
          />
          <label className="admin-check">
            <input
              type="checkbox"
              checked={genAutoEmail}
              onChange={(e) => setGenAutoEmail(e.target.checked)}
            />
            Email it
          </label>
          <button className="admin-btn admin-btn-primary" type="submit">
            Generate
          </button>
        </div>
        {notice && <div className="admin-notice">{notice}</div>}
      </form>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          placeholder="Search key, email, order…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="admin-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="activated">Activated</option>
          <option value="pending">Pending</option>
          <option value="revoked">Revoked</option>
        </select>
        <button className="admin-btn" onClick={() => adminDownload('/licenses/export', 'licenses.csv')}>
          Export CSV
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Email</th>
              <th>Status</th>
              <th>Order</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {busy && (
              <tr>
                <td colSpan={6} className="admin-muted">Loading…</td>
              </tr>
            )}
            {!busy && licenses.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-muted">No licenses found.</td>
              </tr>
            )}
            {licenses.map((l) => {
              const state = l.revoked ? 'Revoked' : l.used ? 'Activated' : 'Pending';
              return (
                <tr key={l.id}>
                  <td className="admin-mono">{l.key}</td>
                  <td>{l.email || '—'}</td>
                  <td>
                    <span className={'admin-badge badge-' + state.toLowerCase()}>{state}</span>
                  </td>
                  <td>{l.order_id || '—'}</td>
                  <td>{fmtDate(l.created_at)}</td>
                  <td>
                    {l.revoked ? (
                      <button className="admin-btn admin-btn-sm" onClick={() => setRevoked(l.id, false)}>
                        Reinstate
                      </button>
                    ) : (
                      <button
                        className="admin-btn admin-btn-sm admin-btn-danger"
                        onClick={() => setRevoked(l.id, true)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Buyers ────────────────────────────────────────────────────────────────────
function BuyersTab() {
  const [buyers, setBuyers] = useState([]);
  const [search, setSearch] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const { data } = await adminFetch(`/buyers?${params.toString()}`);
    setBuyers(data?.buyers || []);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setNotice('');
    const { ok, data } = await adminFetch('/buyers', {
      method: 'POST',
      body: { email: newEmail.trim() },
    });
    if (ok) {
      setNewEmail('');
      load();
    } else setNotice(data?.error || 'Could not add buyer.');
  }

  async function toggle(id, active) {
    await adminFetch(`/buyers/${id}/${active ? 'deactivate' : 'reactivate'}`, { method: 'POST' });
    load();
  }

  async function resend(email) {
    setNotice('');
    const { ok, data } = await adminFetch('/resend-email', { method: 'POST', body: { email } });
    setNotice(ok ? (data?.stub ? `Email stubbed for ${email} (Resend not configured).` : `Email resent to ${email}.`) : data?.error || 'Resend failed.');
  }

  async function importCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [email, order_id] = line.split(',').map((s) => s.trim());
        return { email, order_id };
      })
      .filter((r) => r.email && r.email.includes('@') && r.email.toLowerCase() !== 'email');
    if (!rows.length) {
      setNotice('No valid rows in CSV.');
      e.target.value = '';
      return;
    }
    const { ok, data } = await adminFetch('/buyers/import', { method: 'POST', body: { rows } });
    setNotice(ok ? `Imported ${data?.imported} buyer(s).` : data?.error || 'Import failed.');
    e.target.value = '';
    load();
  }

  return (
    <div>
      <form className="admin-panel" onSubmit={add}>
        <h3 className="admin-section-title">Add / Import Buyers</h3>
        <div className="admin-row">
          <input
            className="admin-input"
            type="email"
            placeholder="buyer@email.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button className="admin-btn admin-btn-primary" type="submit">Add Buyer</button>
          <label className="admin-btn admin-file-btn">
            Import CSV
            <input type="file" accept=".csv,text/csv" onChange={importCsv} hidden />
          </label>
        </div>
        {notice && <div className="admin-notice">{notice}</div>}
      </form>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          placeholder="Search email or order…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Purchased</th>
              <th>Order</th>
              <th>License</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {buyers.length === 0 && (
              <tr><td colSpan={6} className="admin-muted">No buyers found.</td></tr>
            )}
            {buyers.map((b) => (
              <tr key={b.id}>
                <td>{b.email}</td>
                <td>{fmtDate(b.purchase_date)}</td>
                <td>{b.order_id || '—'}</td>
                <td className="admin-mono">{b.license_key || '—'}</td>
                <td>
                  <span className={'admin-badge ' + (b.active ? 'badge-activated' : 'badge-revoked')}>
                    {b.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="admin-actions">
                  <button className="admin-btn admin-btn-sm" onClick={() => resend(b.email)}>
                    Resend
                  </button>
                  <button
                    className={'admin-btn admin-btn-sm' + (b.active ? ' admin-btn-danger' : '')}
                    onClick={() => toggle(b.id, b.active)}
                  >
                    {b.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await adminFetch('/users');
    setUsers(data?.users || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id) {
    await adminFetch(`/users/${id}/revoke`, { method: 'POST' });
    load();
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Niche</th>
            <th>Activated</th>
            <th>Last active</th>
            <th>Chats</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} className="admin-muted">Loading…</td></tr>}
          {!loading && users.length === 0 && (
            <tr><td colSpan={7} className="admin-muted">No users yet.</td></tr>
          )}
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name || '—'}</td>
              <td>{u.email || '—'}</td>
              <td>{u.niche || '—'}</td>
              <td>{fmtDate(u.activatedAt)}</td>
              <td>{fmtDate(u.lastActive)}</td>
              <td>{u.conversationCount}</td>
              <td>
                <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => revoke(u.id)}>
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Webhook logs ────────────────────────────────────────────────────────────────
function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    const { data } = await adminFetch(`/webhook-logs?${params.toString()}`);
    setLogs(data?.logs || []);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="admin-toolbar">
        <select className="admin-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Email</th>
              <th>Order</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} className="admin-muted">No log entries.</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDate(l.created_at)}</td>
                <td>{l.source}</td>
                <td>{l.email || '—'}</td>
                <td>{l.order_id || '—'}</td>
                <td><span className={'admin-badge badge-' + l.status}>{l.status}</span></td>
                <td className="admin-detail">{l.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard', Comp: StatsTab },
  { key: 'licenses', label: 'Licenses', Comp: LicensesTab },
  { key: 'buyers', label: 'Approved Buyers', Comp: BuyersTab },
  { key: 'users', label: 'Active Users', Comp: UsersTab },
  { key: 'logs', label: 'Webhook Logs', Comp: LogsTab },
];

function AdminDashboard({ email, onLogout }) {
  const [tab, setTab] = useState('dashboard');
  const Active = TABS.find((t) => t.key === tab)?.Comp || StatsTab;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header-brand">
          <TinManIcon size={32} />
          <span>Admin Panel</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-muted">{email}</span>
          <button className="admin-btn admin-btn-sm" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'admin-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="admin-main">
        <Active />
      </main>
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!getAdminToken()) {
      setChecking(false);
      return;
    }
    adminFetch('/me').then(({ ok, data }) => {
      if (ok && data?.email) {
        setEmail(data.email);
        setAuthed(true);
      } else {
        clearAdminToken();
      }
      setChecking(false);
    });
  }, []);

  function handleLogout() {
    clearAdminToken();
    setAuthed(false);
    setEmail('');
  }

  if (checking) return <div className="admin-login-screen admin-muted">Loading…</div>;
  if (!authed) {
    return (
      <AdminLogin
        onLogin={(e) => {
          setEmail(e);
          setAuthed(true);
        }}
      />
    );
  }
  return <AdminDashboard email={email} onLogout={handleLogout} />;
}
