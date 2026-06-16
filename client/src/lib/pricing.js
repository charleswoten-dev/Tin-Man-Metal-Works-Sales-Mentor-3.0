// ============================================================================
//  pricing.js — pure pricing math (no React, no Supabase).
//  Two entry points: computeShopRate() and computeQuote().
//  Kept pure so the same logic can be unit-tested and reused server-side.
//  See PRICING_MODULE_SPEC.md §3 for the formulas + sources.
// ============================================================================

const WEEKS_PER_MONTH = 4.33;
export const MARKET_FLOOR_HR = 35; // forum-sourced sanity floor

// Charles's shop calibration (Tin Man Metal Works).
export const DEFAULT_RATE_HR = 125; // fallback shop rate when none is saved yet
export const JOB_MINIMUM = 125;     // no job goes out the door below this total

// Thickness-driven cut/pierce pricing. Thicker steel = slower cut + harder
// pierce, so both rates climb with thickness. `value` is the stored key.
export const THICKNESS_TIERS = [
  { value: '0.25',  label: '≤ ¼"',  cost_per_inch: 0.20, cost_per_pierce: 0.15 },
  { value: '0.375', label: '3/8"',  cost_per_inch: 0.26, cost_per_pierce: 0.16 },
  { value: '0.5',   label: '½"',    cost_per_inch: 0.32, cost_per_pierce: 0.20 },
  { value: '0.75',  label: '¾"',    cost_per_inch: 0.42, cost_per_pierce: 0.30 },
  { value: '1',     label: '1"',    cost_per_inch: 0.58, cost_per_pierce: 0.45 },
];
export const DEFAULT_THICKNESS = '0.25';

const tierFor = (value) =>
  THICKNESS_TIERS.find((t) => t.value === String(value)) || THICKNESS_TIERS[0];

// Forum/industry-sourced defaults. Editable per user; calibrate to the real shop.
export const RATE_DEFAULTS = {
  mode: 'cost',
  // Mode A — cost build-up
  wage_hr: 55,
  burden_pct: 30,
  machine_monthly_cost: 1200,
  overhead_monthly: 900,
  work_hours_week: 40,
  billable_pct: 65,
  margin_pct: 32,
  // Mode B — income goal
  target_income_yr: 80000,
  annual_expenses: 24000,
  work_weeks_yr: 50,
  // per-user job-calc defaults
  material_markup: 2,
  scrap_pct: 7,
  // Fallback cut rates (used if no thickness picked). Match the ≤¼" tier.
  cost_per_pierce: 0.15,
  cost_per_inch: 0.20,
};

export const QUOTE_DEFAULTS = {
  material_cost: 0,
  thickness: DEFAULT_THICKNESS,
  pierces: 0,
  cut_inches: 0,
  run_minutes: 0,
  cad_hours: 0,
  setup_hours: 0,
  quantity: 1,
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Compute the shop's break-even and recommended hourly rate.
 * @returns {{ breakeven_hr:number, rate_hr:number, markup_equiv:number, below_floor:boolean }}
 */
export function computeShopRate(r = {}) {
  const mode = r.mode === 'income' ? 'income' : 'cost';

  if (mode === 'income') {
    // Mode B — work back from a take-home target. §3.2
    const billableHoursYr =
      num(r.work_hours_week) * num(r.work_weeks_yr) * (num(r.billable_pct) / 100);
    const rate = billableHoursYr > 0
      ? (num(r.target_income_yr) + num(r.annual_expenses)) / billableHoursYr
      : 0;
    // In income mode the "break-even" is expenses-only coverage.
    const breakeven = billableHoursYr > 0 ? num(r.annual_expenses) / billableHoursYr : 0;
    return {
      breakeven_hr: round2(breakeven),
      rate_hr: round2(rate),
      markup_equiv: 0,
      below_floor: rate > 0 && rate < MARKET_FLOOR_HR,
    };
  }

  // Mode A — cost build-up. §3.1
  const laborCostHr = num(r.wage_hr) * (1 + num(r.burden_pct) / 100);
  const billableHoursMo =
    num(r.work_hours_week) * WEEKS_PER_MONTH * (num(r.billable_pct) / 100);
  const machineCostHr = billableHoursMo > 0 ? num(r.machine_monthly_cost) / billableHoursMo : 0;
  const overheadCostHr = billableHoursMo > 0 ? num(r.overhead_monthly) / billableHoursMo : 0;

  const breakeven = laborCostHr + machineCostHr + overheadCostHr;

  const margin = num(r.margin_pct);
  const rate = margin < 100 ? breakeven / (1 - margin / 100) : breakeven;
  // Equivalent markup % (for the helper label — margin ≠ markup).
  const markupEquiv = breakeven > 0 ? (rate / breakeven - 1) * 100 : 0;

  return {
    breakeven_hr: round2(breakeven),
    rate_hr: round2(rate),
    markup_equiv: round2(markupEquiv),
    below_floor: rate > 0 && rate < MARKET_FLOOR_HR,
  };
}

/**
 * Compute a per-job quote from the shop rate + job inputs. §3.3
 * @param {object} q       job inputs
 * @param {number} rateHr  recommended shop rate (selling)
 * @param {number} breakevenHr  break-even rate (true cost)
 * @param {object} consts  { material_markup, scrap_pct, cost_per_pierce, cost_per_inch }
 */
export function computeQuote(q = {}, rateHr = 0, breakevenHr = 0, consts = {}) {
  const c = { ...RATE_DEFAULTS, ...consts };
  const qty = Math.max(1, num(q.quantity) || 1);

  // No saved shop rate yet? Fall back to the shop default so quotes still work.
  const sellRate = num(rateHr) > 0 ? num(rateHr) : DEFAULT_RATE_HR;
  const costRate = num(breakevenHr) > 0 ? num(breakevenHr) : DEFAULT_RATE_HR;

  // Cut/pierce rates come from the chosen material thickness.
  const tier = tierFor(q.thickness);
  const perPierce = tier.cost_per_pierce;
  const perInch = tier.cost_per_inch;

  const scrapMult = 1 + num(c.scrap_pct) / 100;
  const materialReal = num(q.material_cost) * scrapMult;            // true material cost (with scrap)
  const materialBilled = materialReal * num(c.material_markup);     // marked-up to customer

  const cutCost = num(q.pierces) * perPierce + num(q.cut_inches) * perInch;

  const timeHours = num(q.run_minutes) / 60 + num(q.cad_hours) + num(q.setup_hours);
  const timeCost = timeHours * sellRate;

  const unitPrice = materialBilled + cutCost + timeCost;
  const rawTotal = unitPrice * qty;

  // Shop job minimum — no job leaves below this total.
  const minApplied = rawTotal > 0 && rawTotal < JOB_MINIMUM;
  const totalPrice = minApplied ? JOB_MINIMUM : rawTotal;

  // True cost to build one unit (uses break-even rate, raw material+scrap, cut cost).
  const unitCost = materialReal + cutCost + timeHours * costRate;
  const jobProfit = totalPrice - unitCost * qty;
  const jobProfitPct = totalPrice > 0 ? (jobProfit / totalPrice) * 100 : 0;

  return {
    unit_price: round2(unitPrice),
    total_price: round2(totalPrice),
    raw_total: round2(rawTotal),
    unit_cost: round2(unitCost),
    job_profit: round2(jobProfit),
    job_profit_pct: round2(jobProfitPct),
    material_billed: round2(materialBilled),
    cut_cost: round2(cutCost),
    time_cost: round2(timeCost),
    time_hours: round2(timeHours),
    per_pierce: perPierce,
    per_inch: perInch,
    min_applied: minApplied,
    job_minimum: JOB_MINIMUM,
    below_floor: sellRate > 0 && sellRate < MARKET_FLOOR_HR,
    losing_money: jobProfit < 0,
  };
}
