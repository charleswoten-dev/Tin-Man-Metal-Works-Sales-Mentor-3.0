import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import {
  computeShopRate, computeQuote, RATE_DEFAULTS, QUOTE_DEFAULTS, defaultThicknessRates,
} from '../lib/pricing.js';
import './Pricing.css';

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

// Cents-rate fields (cut $/in, pierce $) display with 2 decimals so 0.2 reads
// as "0.20". Blank stays blank; non-numeric is left untouched (mid-typing).
const fmt2 = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? v : Number(v).toFixed(2));
const fmtTiers = (rows) =>
  (rows || []).map((t) => ({ ...t, cost_per_inch: fmt2(t.cost_per_inch), cost_per_pierce: fmt2(t.cost_per_pierce) }));

// Scalar columns we persist to shop_rate (thickness_rates handled separately as jsonb).
const RATE_COLS = [
  'mode', 'wage_hr', 'burden_pct', 'machine_monthly_cost', 'overhead_monthly',
  'work_hours_week', 'billable_pct', 'margin_pct', 'target_income_yr',
  'annual_expenses', 'work_weeks_yr', 'material_markup', 'scrap_pct',
  'job_minimum', 'default_rate_hr', 'finishing_rate_sqft',
  'cost_per_pierce', 'cost_per_inch',
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState('rate'); // 'rate' | 'quote' | 'saved'
  const [rate, setRate] = useState(RATE_DEFAULTS);
  const [quote, setQuote] = useState(QUOTE_DEFAULTS);
  const [quoteTitle, setQuoteTitle] = useState('');
  const [quoteProjectId, setQuoteProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [savedQuotes, setSavedQuotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [rateSaved, setRateSaved] = useState(false);
  const [quoteSavedMsg, setQuoteSavedMsg] = useState('');

  // ---- load shop_rate + projects + saved quotes on mount --------------------
  const loadQuotes = useCallback(() => {
    if (!user?.id) return;
    supabase
      .from('quotes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSavedQuotes(data || []));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: sr }, { data: pj }] = await Promise.all([
        supabase.from('shop_rate').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('projects').select('id, name').eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      if (sr) {
        // merge saved values over defaults (so new columns still have a default)
        const merged = { ...RATE_DEFAULTS, thickness_rates: fmtTiers(defaultThicknessRates()) };
        for (const k of RATE_COLS) if (sr[k] !== null && sr[k] !== undefined) merged[k] = sr[k];
        if (Array.isArray(sr.thickness_rates) && sr.thickness_rates.length) {
          merged.thickness_rates = fmtTiers(sr.thickness_rates);
        }
        setRate(merged);
      } else {
        setRate({ ...RATE_DEFAULTS, thickness_rates: fmtTiers(defaultThicknessRates()) });
      }
      setProjects(pj || []);
      loadQuotes();
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id, loadQuotes]);

  // ---- live computations ----------------------------------------------------
  const rateResult = useMemo(() => computeShopRate(rate), [rate]);
  const quoteResult = useMemo(
    () => computeQuote(quote, rateResult.rate_hr, rateResult.breakeven_hr, rate),
    [quote, rateResult, rate],
  );

  const hasSavedRate = rateResult.rate_hr > 0;

  // ---- field helpers --------------------------------------------------------
  const setR = (k) => (e) => { setRate((r) => ({ ...r, [k]: e.target.value })); setRateSaved(false); };
  const setQ = (k) => (e) => setQuote((q) => ({ ...q, [k]: e.target.value }));
  const setQBool = (k) => (e) => setQuote((q) => ({ ...q, [k]: e.target.checked }));
  // edit one cell of the per-thickness rate table
  const setTier = (i, field) => (e) => {
    const v = e.target.value;
    setRate((r) => ({
      ...r,
      thickness_rates: (r.thickness_rates || []).map((t, idx) => (idx === i ? { ...t, [field]: v } : t)),
    }));
    setRateSaved(false);
  };
  // re-format a cents cell to 2 decimals when the user leaves the field
  const blurTier = (i, field) => () => {
    setRate((r) => ({
      ...r,
      thickness_rates: (r.thickness_rates || []).map((t, idx) => (idx === i ? { ...t, [field]: fmt2(t[field]) } : t)),
    }));
  };
  const tiers = rate.thickness_rates || [];

  // ---- save shop rate -------------------------------------------------------
  const saveRate = async () => {
    if (!user?.id) return;
    const row = { user_id: user.id, computed_rate_hr: rateResult.rate_hr, computed_breakeven_hr: rateResult.breakeven_hr };
    for (const k of RATE_COLS) row[k] = rate[k] === '' || rate[k] === undefined ? null : Number.isNaN(Number(rate[k])) ? rate[k] : (k === 'mode' ? rate[k] : Number(rate[k]));
    row.mode = rate.mode === 'income' ? 'income' : 'cost';
    row.thickness_rates = (rate.thickness_rates || []).map((t) => ({
      value: String(t.value),
      label: t.label,
      cost_per_inch: Number(t.cost_per_inch) || 0,
      cost_per_pierce: Number(t.cost_per_pierce) || 0,
      sqft_price: Number(t.sqft_price) || 0,
    }));
    const { error } = await supabase.from('shop_rate').upsert(row, { onConflict: 'user_id' });
    if (!error) {
      setRateSaved(true);
      window.dispatchEvent(new Event('tinman:projects-changed'));
    } else {
      console.error('Failed to save shop rate:', error.message);
    }
  };

  // ---- save quote -----------------------------------------------------------
  const saveQuote = async () => {
    if (!user?.id) return;
    const title = quoteTitle.trim() || 'Untitled quote';
    const row = {
      user_id: user.id,
      project_id: quoteProjectId || null,
      title,
      method: quote.method === 'sqft' ? 'sqft' : 'detailed',
      thickness: String(quote.thickness),
      square_feet: Number(quote.square_feet) || 0,
      finishing: Boolean(quote.finishing),
      finish_sqft: Number(quote.finish_sqft) || 0,
      material_cost: Number(quote.material_cost) || 0,
      pierces: parseInt(quote.pierces, 10) || 0,
      cut_inches: Number(quote.cut_inches) || 0,
      run_minutes: Number(quote.run_minutes) || 0,
      cad_hours: Number(quote.cad_hours) || 0,
      setup_hours: Number(quote.setup_hours) || 0,
      quantity: parseInt(quote.quantity, 10) || 1,
      rate_hr_used: rateResult.rate_hr,
      unit_price: quoteResult.unit_price,
      total_price: quoteResult.total_price,
      job_profit: quoteResult.job_profit,
      status: 'draft',
    };
    const { error } = await supabase.from('quotes').insert(row);
    if (!error) {
      setQuoteSavedMsg(`Saved "${title}"`);
      setTimeout(() => setQuoteSavedMsg(''), 2500);
      loadQuotes();
    } else {
      console.error('Failed to save quote:', error.message);
    }
  };

  // ---- saved-quote actions --------------------------------------------------
  const cloneQuote = async (q) => {
    if (!user?.id) return;
    const { id, created_at, updated_at, ...rest } = q;
    await supabase.from('quotes').insert({ ...rest, title: `${q.title} (copy)`, status: 'draft' });
    loadQuotes();
  };
  const setQuoteStatus = async (q, status) => {
    await supabase.from('quotes').update({ status }).eq('id', q.id);
    loadQuotes();
  };
  const deleteQuote = async (q) => {
    await supabase.from('quotes').delete().eq('id', q.id);
    loadQuotes();
  };

  // ---- send current quote to the Chat mentor --------------------------------
  const sendToMentor = () => {
    const projName = projects.find((p) => p.id === quoteProjectId)?.name;
    const text =
      `I'm pricing a job${quoteTitle ? ` ("${quoteTitle}")` : ''}${projName ? ` for my ${projName} project` : ''}. ` +
      `My shop rate is ${money(rateResult.rate_hr)}/hr (break-even ${money(rateResult.breakeven_hr)}/hr). ` +
      `The calculator gives a unit price of ${money(quoteResult.unit_price)} and a total of ${money(quoteResult.total_price)} ` +
      `for ${quote.quantity || 1}, with an estimated profit of ${money(quoteResult.job_profit)} (${quoteResult.job_profit_pct}%). ` +
      `Does this price make sense, and how should I present it to the customer so I don't get ghosted?`;
    navigate('/chat', { state: { autosend: text } });
  };

  const projName = (id) => projects.find((p) => p.id === id)?.name || null;

  return (
    <div className="pricing-view">
      <div className="pricing-head">
        <span className="pricing-kicker">YBR · Know Your Numbers</span>
        <h1 className="pricing-title">Pricing &amp; Quotes</h1>
        <p className="pricing-sub">
          Stop guessing. Build your true shop rate once, then quote every job from your own real
          costs — so every price you send actually makes you money.
        </p>
      </div>

      <div className="pricing-tabs">
        <button className={tab === 'rate' ? 'on' : ''} onClick={() => setTab('rate')}>① Build My Shop Rate</button>
        <button className={tab === 'quote' ? 'on' : ''} onClick={() => setTab('quote')}>② Quote a Job</button>
        <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>
          📁 Saved Quotes{savedQuotes.length ? ` (${savedQuotes.length})` : ''}
        </button>
      </div>

      {!loaded && <div className="pricing-loading">Loading…</div>}

      {/* ============================ TAB 1: SHOP RATE ====================== */}
      {loaded && tab === 'rate' && (
        <>
        <div className="pricing-grid">
          <section className="pcard">
            <div className="pcard-head">
              <h2>Build My Shop Rate</h2>
              <div className="mode-toggle">
                <button className={rate.mode !== 'income' ? 'on' : ''} onClick={() => setR('mode')({ target: { value: 'cost' } })}>From costs</button>
                <button className={rate.mode === 'income' ? 'on' : ''} onClick={() => setR('mode')({ target: { value: 'income' } })}>From income goal</button>
              </div>
            </div>

            {rate.mode !== 'income' ? (
              <>
                <Field label="Pay yourself / hour" hint="Market range $40–135/hr. Don't lowball your time." prefix="$" value={rate.wage_hr} onChange={setR('wage_hr')} />
                <Field label="Labor burden" hint="Payroll tax, insurance, PTO on top of wage (~30%)" suffix="%" value={rate.burden_pct} onChange={setR('burden_pct')} />
                <Field label="Machine cost / month" hint="Payment + consumables + power + gas" prefix="$" value={rate.machine_monthly_cost} onChange={setR('machine_monthly_cost')} />
                <Field label="Overhead / month" hint="Rent, insurance, software, phone" prefix="$" value={rate.overhead_monthly} onChange={setR('overhead_monthly')} />
                <Field label="Hours worked / week" value={rate.work_hours_week} onChange={setR('work_hours_week')} />
                <Field label="Billable time" hint="You don't bill 100% — admin & quoting eat the rest (50–70%)" suffix="%" value={rate.billable_pct} onChange={setR('billable_pct')} />
                <Field label="Target profit margin" hint="Profit on purpose — gross margin, not markup" suffix="%" value={rate.margin_pct} onChange={setR('margin_pct')} />
              </>
            ) : (
              <>
                <Field label="Take-home income goal / year" prefix="$" value={rate.target_income_yr} onChange={setR('target_income_yr')} />
                <Field label="Business expenses / year" hint="Everything the shop costs to run for a year" prefix="$" value={rate.annual_expenses} onChange={setR('annual_expenses')} />
                <Field label="Hours worked / week" value={rate.work_hours_week} onChange={setR('work_hours_week')} />
                <Field label="Working weeks / year" hint="Subtract vacation, holidays, sick days" value={rate.work_weeks_yr} onChange={setR('work_weeks_yr')} />
                <Field label="Billable time" hint="50–70% — the rest is admin, quoting, marketing" suffix="%" value={rate.billable_pct} onChange={setR('billable_pct')} />
              </>
            )}

            <div className="result-block">
              <div className="result-cols">
                <div>
                  <div className="result-lbl">Break-even rate</div>
                  <div className="result-mid">{money(rateResult.breakeven_hr)}<span>/hr</span></div>
                  <div className="result-note">The floor. Charge less and you lose money.</div>
                </div>
                <div>
                  <div className="result-lbl">Recommended rate</div>
                  <div className="result-big">{money(rateResult.rate_hr)}<span>/hr</span></div>
                  <div className="result-note">
                    {rate.mode !== 'income' && rateResult.markup_equiv > 0
                      ? `${rate.margin_pct}% margin (= ${rateResult.markup_equiv}% markup). Every quote builds on this.`
                      : 'Every quote builds on this.'}
                  </div>
                </div>
              </div>
            </div>

            {rateResult.below_floor && (
              <div className="warn-flag">
                <span>⚠️</span>
                <div>This rate is <b>below the ${'​'}35/hr market floor</b> we found in the research.
                  You're probably leaving out consumables wear or undercounting overhead — let's fix the inputs.</div>
              </div>
            )}

            <div className="save-bar">
              <button className="btn-primary" onClick={saveRate}>{rateSaved ? '✓ Saved' : 'Save my shop rate'}</button>
              <button className="btn-ghost" onClick={() => setTab('quote')}>Quote a job →</button>
            </div>
          </section>

          <aside className="pcard pcard-edu">
            <h2>Why this matters</h2>
            <p>Most fab shops price by gut and quietly lose money. Your <b>shop rate</b> is the real
              hourly cost of running your shop — labor (with burden), machine, and overhead — spread
              across the hours you can actually bill.</p>
            <p>The <b>billable %</b> is the one almost everyone misses: if half your week is quoting,
              ordering, and admin, your real costs ride on the <i>other</i> half — so your rate has to
              be higher to cover them.</p>
            <p>Set this once. Every quote on the next tab is built straight from it.</p>
          </aside>
        </div>

        {/* ---- editable job-pricing rates (baselines; adjust for your area) ---- */}
        <section className="pcard pcard-rates">
          <div className="pcard-head">
            <h2>Job Rates &amp; Baselines</h2>
          </div>
          <p className="rates-intro">These are starting points — material market, location, and competition shift them. Tune them to your shop, then every quote uses your numbers.</p>

          <div className="rates-grid">
            <Field label="Material markup" hint="Multiplier on material cost" suffix="×" value={rate.material_markup} onChange={setR('material_markup')} />
            <Field label="Scrap allowance" suffix="%" value={rate.scrap_pct} onChange={setR('scrap_pct')} />
            <Field label="Default shop rate" hint="Used until you build your own" prefix="$" value={rate.default_rate_hr} onChange={setR('default_rate_hr')} />
            <Field label="Job minimum" hint="No job goes out below this" prefix="$" value={rate.job_minimum} onChange={setR('job_minimum')} />
            <Field label="Finishing rate" hint="Paint / powdercoat" prefix="$" suffix="/ sq ft" value={rate.finishing_rate_sqft} onChange={setR('finishing_rate_sqft')} />
          </div>

          <h3 className="rates-subhead">Cut &amp; pierce + sq-ft price by thickness</h3>
          <div className="thickness-table">
            <div className="tt-row tt-head">
              <span>Thickness</span><span>Cut $/in</span><span>Pierce $</span><span>$ / sq ft</span>
            </div>
            {tiers.map((t, i) => (
              <div className="tt-row" key={t.value}>
                <span className="tt-label">{t.label}</span>
                <input type="number" step="any" inputMode="decimal" value={t.cost_per_inch ?? ''} onChange={setTier(i, 'cost_per_inch')} onBlur={blurTier(i, 'cost_per_inch')} />
                <input type="number" step="any" inputMode="decimal" value={t.cost_per_pierce ?? ''} onChange={setTier(i, 'cost_per_pierce')} onBlur={blurTier(i, 'cost_per_pierce')} />
                <input type="number" step="any" inputMode="decimal" value={t.sqft_price ?? ''} onChange={setTier(i, 'sqft_price')} />
              </div>
            ))}
          </div>

          <div className="save-bar">
            <button className="btn-primary" onClick={saveRate}>{rateSaved ? '✓ Saved' : 'Save my rates'}</button>
          </div>
        </section>
        </>
      )}

      {/* ============================ TAB 2: QUOTE ========================== */}
      {loaded && tab === 'quote' && (
        <div className="pricing-grid">
          <section className="pcard">
            <h2>Quote a Job</h2>

            {!hasSavedRate && (
              <div className="warn-flag info">
                <span>💡</span>
                <div>Build your shop rate first so quotes use your real numbers.
                  <button className="link-btn" onClick={() => setTab('rate')}>Set my shop rate →</button></div>
              </div>
            )}

            <Field label="Job name" type="text" placeholder="e.g. Ranch Gate Sign" value={quoteTitle} onChange={(e) => setQuoteTitle(e.target.value)} />

            <div className="mode-toggle">
              <button className={quote.method !== 'sqft' ? 'on' : ''} onClick={() => setQ('method')({ target: { value: 'detailed' } })}>Detailed</button>
              <button className={quote.method === 'sqft' ? 'on' : ''} onClick={() => setQ('method')({ target: { value: 'sqft' } })}>By square foot</button>
            </div>

            <div className="pfield">
              <label>Material thickness<span className="pfield-hint">{quote.method === 'sqft' ? 'Sets the $/sq ft for signage' : 'Thicker steel = higher pierce & cut rates'}</span></label>
              <div className="pfield-input">
                <select value={quote.thickness} onChange={setQ('thickness')}>
                  {tiers.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {quote.method === 'sqft' ? (
              <>
                <Field label="Square feet" hint={`${money(quoteResult.sqft_price)} / sq ft at this thickness`} value={quote.square_feet} onChange={setQ('square_feet')} />
              </>
            ) : (
              <>
                <Field label="Material cost" hint={`× ${rate.material_markup} markup, + ${rate.scrap_pct}% scrap`} prefix="$" value={quote.material_cost} onChange={setQ('material_cost')} />
                <Field label="Pierces" hint={`${money(quoteResult.per_pierce)} each at this thickness`} value={quote.pierces} onChange={setQ('pierces')} />
                <Field label="Cut length (linear in.)" hint={`${money(quoteResult.per_inch)} / in. at this thickness`} value={quote.cut_inches} onChange={setQ('cut_inches')} />
                <Field label="Machine run time (min)" value={quote.run_minutes} onChange={setQ('run_minutes')} />
                <Field label="Design / CAD time (hrs)" hint="Most-forgotten cost" value={quote.cad_hours} onChange={setQ('cad_hours')} />
                <Field label="Setup & handling (hrs)" hint="The hidden killer" value={quote.setup_hours} onChange={setQ('setup_hours')} />
              </>
            )}

            <div className="pfield">
              <label>
                <span className="check-row"><input type="checkbox" checked={!!quote.finishing} onChange={setQBool('finishing')} /> Paint / powdercoat</span>
                <span className="pfield-hint">{money(rate.finishing_rate_sqft)} / sq ft finishing</span>
              </label>
              {quote.finishing && quote.method !== 'sqft' && (
                <div className="pfield-input">
                  <input type="number" step="any" inputMode="decimal" value={quote.finish_sqft ?? ''} onChange={setQ('finish_sqft')} placeholder="sq ft" />
                  <span className="affix">sq ft</span>
                </div>
              )}
            </div>

            <Field label="Quantity" value={quote.quantity} onChange={setQ('quantity')} />

            <label className="project-select">
              <span>Attach to project</span>
              <select value={quoteProjectId} onChange={(e) => setQuoteProjectId(e.target.value)}>
                <option value="">— none —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <div className="save-bar">
              <button className="btn-primary" onClick={saveQuote}>Save quote</button>
              <button className="btn-ghost" onClick={sendToMentor}>Send to Chat mentor</button>
            </div>
            {quoteSavedMsg && <div className="saved-msg">✓ {quoteSavedMsg}</div>}
          </section>

          <aside className="pcard pcard-result">
            <h2>The Numbers</h2>
            <div className="breakdown">
              {quote.method === 'sqft' ? (
                <Row k={`Signage — ${quote.square_feet || 0} sq ft × ${money(quoteResult.sqft_price)}`} v={money(quoteResult.base_price)} />
              ) : (
                <>
                  <Row k={`Material (×${rate.material_markup}, +${rate.scrap_pct}% scrap)`} v={money(quoteResult.material_billed)} />
                  <Row k="Cutting (pierce + length)" v={money(quoteResult.cut_cost)} />
                  <Row k={`Time — ${quoteResult.time_hours} hr × ${money(rateResult.rate_hr)}`} v={money(quoteResult.time_cost)} />
                </>
              )}
              {quoteResult.finish_cost > 0 && (
                <Row k={`Finishing (paint / powder)`} v={money(quoteResult.finish_cost)} />
              )}
              <Row k="Price per part" v={money(quoteResult.unit_price)} strong />
            </div>

            <div className="result-block tight">
              <div className="result-lbl">Total quote ({quote.quantity || 1} pc)</div>
              <div className="result-big">{money(quoteResult.total_price)}</div>
              {quoteResult.profit_known ? (
                <div className={'profit-line' + (quoteResult.losing_money ? ' loss' : '')}>
                  {quoteResult.losing_money ? 'Loss' : 'Profit'}: {money(quoteResult.job_profit)} ({quoteResult.job_profit_pct}%)
                </div>
              ) : (
                <div className="result-note">All-in square-foot price. Set your $/sq ft to already include your margin.</div>
              )}
            </div>

            {quoteResult.min_applied && (
              <div className="warn-flag info">
                <span>🧾</span>
                <div>The math came to {money(quoteResult.raw_total)}, but your <b>{money(quoteResult.job_minimum)} job minimum</b> applies —
                  small jobs still cost setup, design, and handling time.</div>
              </div>
            )}

            {quoteResult.losing_money && (
              <div className="warn-flag">
                <span>⚠️</span>
                <div>At this price you'd <b>lose {money(Math.abs(quoteResult.job_profit))}</b>. It costs you
                  about {money(quoteResult.unit_cost)} to build one. Raise the price or trim cost.</div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ============================ TAB 3: SAVED ========================== */}
      {loaded && tab === 'saved' && (
        <div className="saved-wrap">
          {savedQuotes.length === 0 ? (
            <div className="saved-empty">
              <h2>No saved quotes yet</h2>
              <p>Price a job on the <button className="link-btn" onClick={() => setTab('quote')}>Quote a Job</button> tab and save it here.</p>
            </div>
          ) : (
            <ul className="quote-list">
              {savedQuotes.map((q) => (
                <li key={q.id} className="quote-row">
                  <div className="quote-main">
                    <div className="quote-title">{q.title}</div>
                    <div className="quote-meta">
                      {money(q.total_price)} total · {money(q.unit_price)}/pc · qty {q.quantity}
                      {q.project_id && projName(q.project_id) ? ` · ${projName(q.project_id)}` : ''}
                      {' · '}profit {money(q.job_profit)}
                    </div>
                  </div>
                  <div className="quote-actions">
                    <select className={'status-chip s-' + q.status} value={q.status} onChange={(e) => setQuoteStatus(q, e.target.value)}>
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                    </select>
                    <button className="mini-btn" onClick={() => cloneQuote(q)} title="Clone">Clone</button>
                    <button className="mini-btn danger" onClick={() => deleteQuote(q)} title="Delete">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- small presentational helpers ------------------------------------------
function Field({ label, hint, prefix, suffix, value, onChange, type = 'number', placeholder }) {
  return (
    <div className="pfield">
      <label>{label}{hint && <span className="pfield-hint">{hint}</span>}</label>
      <div className="pfield-input">
        {prefix && <span className="affix">{prefix}</span>}
        <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder}
          step="any" inputMode={type === 'number' ? 'decimal' : undefined} />
        {suffix && <span className="affix">{suffix}</span>}
      </div>
    </div>
  );
}

function Row({ k, v, strong }) {
  return (
    <div className={'brow' + (strong ? ' brow-strong' : '')}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
