-- ============================================================================
--  Tin Man — PRICING MODULE migration (run ONCE in Supabase → SQL Editor).
--  Creates shop_rate + quotes. Safe to re-run (if not exists / drop-if-exists).
--  Already included in schema.sql; this file is just the pricing slice so you
--  can paste it without re-running the whole schema.
-- ============================================================================

-- 12. SHOP_RATE  (one row per user — user_id is the PK so upserts are 1:1)
create table if not exists public.shop_rate (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  mode                  text not null default 'cost' check (mode in ('cost','income')),
  wage_hr               numeric,
  burden_pct            numeric default 30,
  machine_monthly_cost  numeric,
  overhead_monthly      numeric,
  work_hours_week       numeric default 40,
  billable_pct          numeric default 65,
  margin_pct            numeric default 32,
  target_income_yr      numeric,
  annual_expenses       numeric,
  work_weeks_yr         numeric default 50,
  material_markup       numeric default 1.5,
  scrap_pct             numeric default 5,
  cost_per_pierce       numeric default 0.18,
  cost_per_inch         numeric default 0.15,
  computed_rate_hr      numeric,
  computed_breakeven_hr numeric,
  updated_at            timestamptz not null default now()
);

-- 13. QUOTES  (saved job estimates; optionally linked to a project)
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  title           text not null,
  material_cost   numeric,
  pierces         integer,
  cut_inches      numeric,
  run_minutes     numeric,
  cad_hours       numeric,
  setup_hours     numeric,
  quantity        integer default 1,
  rate_hr_used    numeric,
  unit_price      numeric,
  total_price     numeric,
  job_profit      numeric,
  status          text not null default 'draft' check (status in ('draft','sent','won','lost')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists quotes_user_idx on public.quotes (user_id, created_at desc);
create index if not exists quotes_project_idx on public.quotes (project_id);

-- own rows only ---------------------------------------------------------------
alter table public.shop_rate enable row level security;
alter table public.quotes    enable row level security;

drop policy if exists "shop_rate_all_own" on public.shop_rate;
create policy "shop_rate_all_own" on public.shop_rate
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "quotes_all_own" on public.quotes;
create policy "quotes_all_own" on public.quotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep updated_at fresh (set_updated_at() already exists from schema.sql)
drop trigger if exists shop_rate_set_updated_at on public.shop_rate;
create trigger shop_rate_set_updated_at
  before update on public.shop_rate
  for each row execute function public.set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();
