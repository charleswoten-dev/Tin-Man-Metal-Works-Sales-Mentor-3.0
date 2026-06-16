-- ============================================================================
--  Tin Man — PRICING MODULE migration v2 (run ONCE in Supabase → SQL Editor).
--  Adds editable job-rate baselines + square-foot signage + finishing support.
--  Safe to re-run (add column if not exists).
-- ============================================================================

-- shop_rate: editable baselines + per-thickness rate table (jsonb) ------------
alter table public.shop_rate
  add column if not exists job_minimum         numeric default 125,
  add column if not exists default_rate_hr     numeric default 125,
  add column if not exists finishing_rate_sqft numeric default 8,
  add column if not exists thickness_rates     jsonb;

-- quotes: square-foot method + finishing -------------------------------------
alter table public.quotes
  add column if not exists method      text default 'detailed',
  add column if not exists thickness   text,
  add column if not exists square_feet numeric,
  add column if not exists finishing   boolean default false,
  add column if not exists finish_sqft numeric;
