import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { getPendingImport, clearPendingImport } from '../lib/importHandoff.js';
import './ImportCalculatorData.css';

// Columns we accept into shop_rate (everything else in the payload is ignored,
// so a future change to the calculator can't break the insert). Mirrors the
// shop_rate writer in views/Pricing.jsx.
const RATE_COLS = [
  'mode', 'wage_hr', 'burden_pct', 'machine_monthly_cost', 'overhead_monthly',
  'work_hours_week', 'billable_pct', 'margin_pct', 'target_income_yr',
  'annual_expenses', 'work_weeks_yr', 'material_markup', 'scrap_pct',
  'job_minimum', 'default_rate_hr', 'finishing_rate_sqft',
  'cost_per_pierce', 'cost_per_inch',
  'computed_rate_hr', 'computed_breakeven_hr', 'thickness_rates',
];

const QUOTE_COLS = [
  'title', 'method', 'thickness', 'square_feet', 'finishing', 'finish_sqft',
  'material_cost', 'pierces', 'cut_inches', 'run_minutes', 'cad_hours',
  'setup_hours', 'quantity', 'rate_hr_used', 'unit_price', 'total_price',
  'job_profit', 'status',
];

const pick = (obj, cols) => {
  const out = {};
  for (const c of cols) if (obj[c] !== undefined) out[c] = obj[c];
  return out;
};

// Offers to pull a visitor's saved data from the free Shop Rate Calculator into
// their Mentor account. Shows only when a stashed payload exists (set by
// captureIncomingImport on arrival from an upgrade link) and the user is signed
// in. Mounted in Layout after onboarding/tour so modals don't stack.
export default function ImportCalculatorData() {
  const { user } = useAuth();
  const [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''); // '', 'done', 'error'

  useEffect(() => {
    if (!user?.id) return;
    setPayload(getPendingImport());
  }, [user?.id]);

  if (!payload || !user?.id) return null;

  const hasRate = payload.rate && typeof payload.rate === 'object';
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  const quoteCount = quotes.length;

  const dismiss = () => {
    clearPendingImport();
    setPayload(null);
  };

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      if (hasRate) {
        const row = pick(payload.rate, RATE_COLS);
        row.user_id = user.id;
        row.mode = row.mode === 'income' ? 'income' : 'cost';
        const { error } = await supabase
          .from('shop_rate')
          .upsert(row, { onConflict: 'user_id' });
        if (error) throw error;
      }
      if (quoteCount) {
        const rows = quotes.map((q) => {
          const row = pick(q, QUOTE_COLS);
          row.user_id = user.id;
          row.project_id = null;
          if (!row.status) row.status = 'draft';
          return row;
        });
        const { error } = await supabase.from('quotes').insert(rows);
        if (error) throw error;
      }
      clearPendingImport();
      window.dispatchEvent(new Event('tinman:projects-changed'));
      setStatus('done');
      setTimeout(() => setPayload(null), 1900);
    } catch (e) {
      console.error('Calculator import failed:', e?.message || e);
      setStatus('error');
      setBusy(false);
    }
  };

  return (
    <div className="ic-root" role="dialog" aria-modal="true" aria-label="Import calculator data">
      <div className="ic-modal">
        <div className="ic-icon">📥</div>
        <h2 className="ic-title">Bring your calculator numbers in?</h2>
        <p className="ic-lede">
          We found data from the free <b>Shop Rate &amp; Quote Calculator</b>. Want to import it
          into your Sales Mentor account so it's saved here and the Tin Man can use it?
        </p>

        <ul className="ic-list">
          {hasRate && <li>Your saved <b>shop rate</b> &amp; job rate settings</li>}
          {quoteCount > 0 && (
            <li><b>{quoteCount}</b> saved quote{quoteCount === 1 ? '' : 's'}</li>
          )}
        </ul>
        {hasRate && (
          <p className="ic-note">
            Importing your shop rate will replace any rate already set on this account.
          </p>
        )}

        {status === 'error' && (
          <div className="ic-error">Something went wrong importing. Please try again.</div>
        )}
        {status === 'done' && (
          <div className="ic-ok">✓ Imported! Your numbers are now in your account.</div>
        )}

        {status !== 'done' && (
          <div className="ic-actions">
            <button className="ic-btn ghost" onClick={dismiss} disabled={busy}>
              No thanks
            </button>
            <button className="ic-btn primary" onClick={doImport} disabled={busy}>
              {busy ? 'Importing…' : 'Import my data'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
