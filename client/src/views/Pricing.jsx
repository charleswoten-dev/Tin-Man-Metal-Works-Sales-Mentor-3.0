import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import {
  computeShopRate, computeQuote, RATE_DEFAULTS, QUOTE_DEFAULTS, defaultThicknessRates,
} from '../lib/pricing.js';
import PricingTour from '../components/PricingTour.jsx';
import { RefreshIcon } from '../components/Icons.jsx';
import './Pricing.css';

// First-open field-by-field walkthrough for the Pricing tab. Each step points at
// a [data-tour="…"] element; tab/mode/method tell the tour which view to switch
// to first so the field is actually on screen when it's spotlighted. Shared
// almost verbatim with the free standalone calculator.
const PRICING_TOUR_STEPS = [
  { title: 'Welcome — let’s build your real prices',
    body: 'This quick walkthrough explains every box, one at a time. Two minutes now saves you from underpricing for years. Use Next / Back, or Skip anytime.' },
  { target: '[data-tour="tabs"]', title: 'Three simple steps',
    body: '① Build your shop rate (your true hourly cost). ② Quote a job using that rate. ③ Saved quotes live here. We’ll start at ①.' },
  { target: '[data-tour="mode"]', tab: 'rate', mode: 'cost', title: 'Two ways to build your rate',
    body: '“From costs” adds up what your shop actually costs to run. “From income goal” works backward from the take-home you want. We’ll use From costs.' },
  { target: '[data-tour="wage_hr"]', tab: 'rate', mode: 'cost', title: 'Pay yourself / hour',
    body: 'What your own time is worth per hour — pay yourself like the skilled operator you are. Don’t lowball this; everything builds on it.' },
  { target: '[data-tour="burden_pct"]', tab: 'rate', mode: 'cost', title: 'Labor burden',
    body: 'The extra on top of wages — payroll taxes, insurance, paid time off. Roughly 30% is normal. It’s real money your wage number alone misses.' },
  { target: '[data-tour="machine_monthly_cost"]', tab: 'rate', mode: 'cost', title: 'Machine cost / month',
    body: 'Everything the machine costs monthly: payment/lease, consumables (tips, electrodes, gas), and power. This is what keeps the table running.' },
  { target: '[data-tour="overhead_monthly"]', tab: 'rate', mode: 'cost', title: 'Overhead / month',
    body: 'The shop’s monthly bills that aren’t the machine: rent, insurance, software, phone, internet. The cost of keeping the doors open.' },
  { target: '[data-tour="work_hours_week"]', tab: 'rate', mode: 'cost', title: 'Hours worked / week',
    body: 'How many hours you actually work in a typical week. We use this to spread your monthly costs across your time.' },
  { target: '[data-tour="billable_pct"]', tab: 'rate', mode: 'cost', title: 'Billable time — the big one',
    body: 'You can’t bill every hour — quoting, ordering, admin, and cleanup eat a chunk. Most shops bill only 50–70%. Your costs ride on the hours you CAN bill, so this lifts your rate.' },
  { target: '[data-tour="margin_pct"]', tab: 'rate', mode: 'cost', title: 'Target profit margin',
    body: 'Profit on purpose, on top of covering costs. This is gross margin (a share of the price), not markup. 20–40% is common — it’s what funds growth and slow months.' },
  { target: '[data-tour="rate-result"]', tab: 'rate', mode: 'cost', title: 'Your two numbers',
    body: 'Break-even is the floor — charge less and you lose money. Recommended is break-even plus your margin. Every quote is built from the recommended rate.' },
  { target: '[data-tour="target_income_yr"]', tab: 'rate', mode: 'income', title: 'Or: start from an income goal',
    body: 'Switching modes for a sec. Here you enter the take-home pay you want for the year, and we work backward to the hourly rate that gets you there.' },
  { target: '[data-tour="annual_expenses"]', tab: 'rate', mode: 'income', title: 'Business expenses / year',
    body: 'Everything it costs to run the shop for a full year — machine, overhead, consumables, the lot. Added to your income goal before dividing by your hours.' },
  { target: '[data-tour="work_weeks_yr"]', tab: 'rate', mode: 'income', title: 'Working weeks / year',
    body: 'How many weeks you actually work — subtract vacation, holidays, and sick time. Fewer weeks means each working hour has to carry more.' },
  { target: '[data-tour="rate-save"]', tab: 'rate', mode: 'cost', title: 'Save your shop rate',
    body: 'Happy with the numbers? Save it once. Every quote you build will use this rate automatically — and your Chat coach sees it too, so its advice fits your shop.' },
  { target: '[data-tour="baselines"]', tab: 'rate', mode: 'cost', title: 'Job rates & baselines',
    body: 'Starting points for pricing the work itself. Tune them to your shop and area — then every quote uses your numbers, not generic ones.' },
  { target: '[data-tour="material_markup"]', tab: 'rate', mode: 'cost', title: 'Material markup',
    body: 'A multiplier on what you pay for steel. 1.5× means you bill material at 1.5 times cost — it covers handling, waste, and tying up your cash.' },
  { target: '[data-tour="scrap_pct"]', tab: 'rate', mode: 'cost', title: 'Scrap allowance',
    body: 'Drops, skeletons, and mistakes — material you buy but don’t sell. This % quietly adds that loss back so it doesn’t come out of your profit.' },
  { target: '[data-tour="default_rate_hr"]', tab: 'rate', mode: 'cost', title: 'Default shop rate',
    body: 'A fallback hourly rate used only until you save your own. Once you build your rate above, that takes over.' },
  { target: '[data-tour="job_minimum"]', tab: 'rate', mode: 'cost', title: 'Job minimum',
    body: 'No job leaves the shop below this. Even a tiny part eats setup, design, and handling time — the minimum protects you on small work.' },
  { target: '[data-tour="finishing_rate_sqft"]', tab: 'rate', mode: 'cost', title: 'Finishing rate',
    body: 'Your price per square foot for paint or powdercoat. Used when you check “finishing” on a quote.' },
  { target: '[data-tour="thickness"]', tab: 'rate', mode: 'cost', title: 'Cut, pierce & sq-ft by thickness',
    body: 'Thicker steel cuts slower and pierces harder, so it costs more. Set your cut $/inch, $/pierce, and $/sq-ft for each thickness — quotes pull from the row you pick.' },
  { target: '[data-tour="q_title"]', tab: 'quote', method: 'detailed', title: 'Now — quote a job',
    body: 'Give the job a name so you can find it later. Everything here prices against the shop rate you just built.' },
  { target: '[data-tour="q_method"]', tab: 'quote', method: 'detailed', title: 'Detailed vs. by square foot',
    body: '“Detailed” prices from real inputs (material, cuts, time) — most accurate. “By square foot” is a fast all-in price, handy for signage. We’ll walk Detailed.' },
  { target: '[data-tour="q_thickness"]', tab: 'quote', method: 'detailed', title: 'Material thickness',
    body: 'Pick the steel thickness. This sets the cut, pierce, and sq-ft rates from the table you filled in earlier.' },
  { target: '[data-tour="q_material"]', tab: 'quote', method: 'detailed', title: 'Material cost',
    body: 'What this job’s steel costs you. We apply your markup and scrap allowance automatically — just enter your raw cost.' },
  { target: '[data-tour="q_pierces"]', tab: 'quote', method: 'detailed', title: 'Pierces',
    body: 'How many times the torch pierces to start a cut (each hole/cutout = a pierce). Priced at your per-pierce rate for this thickness.' },
  { target: '[data-tour="q_cut"]', tab: 'quote', method: 'detailed', title: 'Cut length',
    body: 'Total linear inches of cutting. Your CAM/nesting software usually reports this. Priced at your per-inch rate for this thickness.' },
  { target: '[data-tour="q_run"]', tab: 'quote', method: 'detailed', title: 'Machine run time',
    body: 'Minutes the machine actually runs the job. Captures table time beyond just cut length (rapids, lead-ins, etc.).' },
  { target: '[data-tour="q_cad"]', tab: 'quote', method: 'detailed', title: 'Design / CAD time',
    body: 'Hours drawing or cleaning up the file. The most-forgotten cost — your design time is worth your shop rate too.' },
  { target: '[data-tour="q_setup"]', tab: 'quote', method: 'detailed', title: 'Setup & handling',
    body: 'Hours loading material, changing consumables, deburring, packaging. The quiet killer on small jobs — count it.' },
  { target: '[data-tour="q_finishing"]', tab: 'quote', method: 'detailed', title: 'Paint / powdercoat',
    body: 'Tick this if the job gets finished, then enter the square footage. We bill it at your finishing rate.' },
  { target: '[data-tour="q_qty"]', tab: 'quote', method: 'detailed', title: 'Quantity',
    body: 'How many of this part. Per-part costs scale, and the total updates live on the right.' },
  { target: '[data-tour="q_project"]', tab: 'quote', method: 'detailed', title: 'Attach to a project',
    body: 'Optionally tie this quote to one of your projects, so your won/lost history and your coach stay organized by job.' },
  { target: '[data-tour="q_result"]', tab: 'quote', method: 'detailed', title: 'The numbers',
    body: 'Your live breakdown: material, cutting, time, finishing → price per part, total, and your profit. If you’d lose money, it warns you in red.' },
  { target: '[data-tour="q_save"]', tab: 'quote', method: 'detailed', title: 'Save it or get a gut-check',
    body: 'Save it to your Saved Quotes, or “Send to Chat mentor” to have your coach sanity-check the price and help you present it without getting ghosted.' },
  { target: '[data-tour="q_sqft"]', tab: 'quote', method: 'sqft', title: 'The quick way: by square foot',
    body: 'Switched to the square-foot method. Enter the area and it prices straight from your $/sq-ft for that thickness — fast for signage and simple flat work.' },
  { target: '[data-tour="saved"]', tab: 'saved', title: 'Saved quotes',
    body: 'Every saved quote lands here. Mark them Draft / Sent / Won / Lost, clone one to start a similar job, or delete. Your win/loss history at a glance.' },
  { title: 'You’re all set 🎉',
    body: 'That’s every box. Build your rate first, then quote away — and re-open this walkthrough anytime with the “Replay walkthrough” button up top.' },
];

const pricingTourKey = (userId) => `tinman:pricingTourSeen:${userId || 'anon'}`;

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
  const [showTour, setShowTour] = useState(false); // pricing walkthrough

  // Auto-run the pricing walkthrough the first time this user opens the tab.
  // Gated in localStorage so it never replays on its own; "Replay walkthrough"
  // re-triggers it manually.
  useEffect(() => {
    if (!user?.id) return;
    if (!localStorage.getItem(pricingTourKey(user.id))) setShowTour(true);
  }, [user?.id]);

  const finishTour = () => {
    if (user?.id) localStorage.setItem(pricingTourKey(user.id), '1');
    setShowTour(false);
  };

  // Each tour step may carry tab/mode/method; switch the view so the spotlighted
  // field is actually on screen before the tour measures it.
  const prepareTourStep = useCallback((step) => {
    if (step.tab) setTab(step.tab);
    if (step.mode) setRate((r) => (r.mode === step.mode ? r : { ...r, mode: step.mode }));
    if (step.method) setQuote((q) => (q.method === step.method ? q : { ...q, method: step.method }));
  }, []);
  const replayTour = () => { setTab('rate'); setShowTour(true); };

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
      <PricingTour steps={PRICING_TOUR_STEPS} run={showTour} onPrepare={prepareTourStep} onClose={finishTour} />

      <div className="pricing-head">
        <button
          className="pricing-tour-btn"
          onClick={replayTour}
          title="Replay the pricing walkthrough"
        >
          <RefreshIcon width={16} height={16} />
          <span>Replay walkthrough</span>
        </button>
        <span className="pricing-kicker">YBR · Know Your Numbers</span>
        <h1 className="pricing-title">Pricing &amp; Quotes</h1>
        <p className="pricing-sub">
          Stop guessing. Build your true shop rate once, then quote every job from your own real
          costs — so every price you send actually makes you money.
        </p>
      </div>

      <div className="pricing-tabs" data-tour="tabs">
        <button data-tour="ptab-rate" className={tab === 'rate' ? 'on' : ''} onClick={() => setTab('rate')}>① Build My Shop Rate</button>
        <button data-tour="ptab-quote" className={tab === 'quote' ? 'on' : ''} onClick={() => setTab('quote')}>② Quote a Job</button>
        <button data-tour="ptab-saved" className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>
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
              <div className="mode-toggle" data-tour="mode">
                <button className={rate.mode !== 'income' ? 'on' : ''} onClick={() => setR('mode')({ target: { value: 'cost' } })}>From costs</button>
                <button className={rate.mode === 'income' ? 'on' : ''} onClick={() => setR('mode')({ target: { value: 'income' } })}>From income goal</button>
              </div>
            </div>

            {rate.mode !== 'income' ? (
              <>
                <Field tourId="wage_hr" label="Pay yourself / hour" hint="Market range $40–135/hr. Don't lowball your time." prefix="$" value={rate.wage_hr} onChange={setR('wage_hr')} />
                <Field tourId="burden_pct" label="Labor burden" hint="Payroll tax, insurance, PTO on top of wage (~30%)" suffix="%" value={rate.burden_pct} onChange={setR('burden_pct')} />
                <Field tourId="machine_monthly_cost" label="Machine cost / month" hint="Payment + consumables + power + gas" prefix="$" value={rate.machine_monthly_cost} onChange={setR('machine_monthly_cost')} />
                <Field tourId="overhead_monthly" label="Overhead / month" hint="Rent, insurance, software, phone" prefix="$" value={rate.overhead_monthly} onChange={setR('overhead_monthly')} />
                <Field tourId="work_hours_week" label="Hours worked / week" value={rate.work_hours_week} onChange={setR('work_hours_week')} />
                <Field tourId="billable_pct" label="Billable time" hint="You don't bill 100% — admin & quoting eat the rest (50–70%)" suffix="%" value={rate.billable_pct} onChange={setR('billable_pct')} />
                <Field tourId="margin_pct" label="Target profit margin" hint="Profit on purpose — gross margin, not markup" suffix="%" value={rate.margin_pct} onChange={setR('margin_pct')} />
              </>
            ) : (
              <>
                <Field tourId="target_income_yr" label="Take-home income goal / year" prefix="$" value={rate.target_income_yr} onChange={setR('target_income_yr')} />
                <Field tourId="annual_expenses" label="Business expenses / year" hint="Everything the shop costs to run for a year" prefix="$" value={rate.annual_expenses} onChange={setR('annual_expenses')} />
                <Field label="Hours worked / week" value={rate.work_hours_week} onChange={setR('work_hours_week')} />
                <Field tourId="work_weeks_yr" label="Working weeks / year" hint="Subtract vacation, holidays, sick days" value={rate.work_weeks_yr} onChange={setR('work_weeks_yr')} />
                <Field label="Billable time" hint="50–70% — the rest is admin, quoting, marketing" suffix="%" value={rate.billable_pct} onChange={setR('billable_pct')} />
              </>
            )}

            <div className="result-block" data-tour="rate-result">
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

            <div className="save-bar" data-tour="rate-save">
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
        <section className="pcard pcard-rates" data-tour="baselines">
          <div className="pcard-head">
            <h2>Job Rates &amp; Baselines</h2>
          </div>
          <p className="rates-intro">These are starting points — material market, location, and competition shift them. Tune them to your shop, then every quote uses your numbers.</p>

          <div className="rates-grid">
            <Field tourId="material_markup" label="Material markup" hint="Multiplier on material cost" suffix="×" value={rate.material_markup} onChange={setR('material_markup')} />
            <Field tourId="scrap_pct" label="Scrap allowance" suffix="%" value={rate.scrap_pct} onChange={setR('scrap_pct')} />
            <Field tourId="default_rate_hr" label="Default shop rate" hint="Used until you build your own" prefix="$" value={rate.default_rate_hr} onChange={setR('default_rate_hr')} />
            <Field tourId="job_minimum" label="Job minimum" hint="No job goes out below this" prefix="$" value={rate.job_minimum} onChange={setR('job_minimum')} />
            <Field tourId="finishing_rate_sqft" label="Finishing rate" hint="Paint / powdercoat" prefix="$" suffix="/ sq ft" value={rate.finishing_rate_sqft} onChange={setR('finishing_rate_sqft')} />
          </div>

          <h3 className="rates-subhead">Cut &amp; pierce + sq-ft price by thickness</h3>
          <div className="thickness-table" data-tour="thickness">
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

            <Field tourId="q_title" label="Job name" type="text" placeholder="e.g. Ranch Gate Sign" value={quoteTitle} onChange={(e) => setQuoteTitle(e.target.value)} />

            <div className="mode-toggle" data-tour="q_method">
              <button className={quote.method !== 'sqft' ? 'on' : ''} onClick={() => setQ('method')({ target: { value: 'detailed' } })}>Detailed</button>
              <button className={quote.method === 'sqft' ? 'on' : ''} onClick={() => setQ('method')({ target: { value: 'sqft' } })}>By square foot</button>
            </div>

            <div className="pfield" data-tour="q_thickness">
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
                <Field tourId="q_sqft" label="Square feet" hint={`${money(quoteResult.sqft_price)} / sq ft at this thickness`} value={quote.square_feet} onChange={setQ('square_feet')} />
              </>
            ) : (
              <>
                <Field tourId="q_material" label="Material cost" hint={`× ${rate.material_markup} markup, + ${rate.scrap_pct}% scrap`} prefix="$" value={quote.material_cost} onChange={setQ('material_cost')} />
                <Field tourId="q_pierces" label="Pierces" hint={`${money(quoteResult.per_pierce)} each at this thickness`} value={quote.pierces} onChange={setQ('pierces')} />
                <Field tourId="q_cut" label="Cut length (linear in.)" hint={`${money(quoteResult.per_inch)} / in. at this thickness`} value={quote.cut_inches} onChange={setQ('cut_inches')} />
                <Field tourId="q_run" label="Machine run time (min)" value={quote.run_minutes} onChange={setQ('run_minutes')} />
                <Field tourId="q_cad" label="Design / CAD time (hrs)" hint="Most-forgotten cost" value={quote.cad_hours} onChange={setQ('cad_hours')} />
                <Field tourId="q_setup" label="Setup & handling (hrs)" hint="The hidden killer" value={quote.setup_hours} onChange={setQ('setup_hours')} />
              </>
            )}

            <div className="pfield" data-tour="q_finishing">
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

            <Field tourId="q_qty" label="Quantity" value={quote.quantity} onChange={setQ('quantity')} />

            <label className="project-select" data-tour="q_project">
              <span>Attach to project</span>
              <select value={quoteProjectId} onChange={(e) => setQuoteProjectId(e.target.value)}>
                <option value="">— none —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <div className="save-bar" data-tour="q_save">
              <button className="btn-primary" onClick={saveQuote}>Save quote</button>
              <button className="btn-ghost" onClick={sendToMentor}>Send to Chat mentor</button>
            </div>
            {quoteSavedMsg && <div className="saved-msg">✓ {quoteSavedMsg}</div>}
          </section>

          <aside className="pcard pcard-result" data-tour="q_result">
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
        <div className="saved-wrap" data-tour="saved">
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
function Field({ label, hint, prefix, suffix, value, onChange, type = 'number', placeholder, tourId }) {
  return (
    <div className="pfield" data-tour={tourId}>
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
