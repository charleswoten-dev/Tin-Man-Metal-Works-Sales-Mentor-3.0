-- ============================================================================
--  Tin Man Metal Works Sales Mentor 3.0 — Database schema
--  Run this ONCE in the Supabase dashboard → SQL Editor → New query → Run.
--  Safe to re-run: uses "if not exists" / "or replace" / "drop ... if exists".
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PROFILES  (one row per user; holds onboarding answers + app flags)
--    Linked 1:1 to Supabase auth.users.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  name                text,

  -- onboarding question answers
  plasma_work         text,   -- "what kind of plasma work do you do"
  time_in_business    text,   -- "how long have you been in business"
  work_status         text,   -- "full time or day job"
  monthly_revenue     text,   -- "current monthly revenue"
  best_products       text,   -- "best selling products"
  best_customers      text,   -- "best customers"
  biggest_struggle    text,   -- "biggest struggle"
  niche               text,   -- selected niche after niche education

  -- app flags / settings
  tour_completed       boolean not null default false,
  onboarding_completed boolean not null default false,
  voice_enabled        boolean not null default false,

  -- API-key handoff (days 1-90 use Charles's key; after day 90 their own)
  anthropic_api_key    text,
  notified_day_80      boolean not null default false,
  notified_day_87      boolean not null default false,
  seen_api_transition  boolean not null default false,

  created_at           timestamptz not null default now(),  -- basis for day-count
  updated_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. MESSAGES  (full chat history; "Start Fresh" deletes a user's rows)
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- which chat thread this message belongs to. null = the shared "General"
  -- thread; a uuid ties it to that project's own thread. The FK to projects is
  -- added after the projects table is created (see end of file).
  project_id  uuid,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at);
create index if not exists messages_user_project_created_idx
  on public.messages (user_id, project_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. SAVES  (My Saves — saved bot messages, organized by type)
-- ----------------------------------------------------------------------------
create table if not exists public.saves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  type        text not null default 'other'
              check (type in ('ad copy','email','guarantee','product title','funnel','other')),
  created_at  timestamptz not null default now()
);
create index if not exists saves_user_idx on public.saves (user_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. PROGRESS  (8-step foundation checklist; one row per completed/known step)
--    step_key is one of: profile_setup, niche_chosen, dream_buyer, offer_built,
--    guarantee_written, first_fb_ad, email_sequence, funnel_mapped
-- ----------------------------------------------------------------------------
create table if not exists public.progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  step_key      text not null,
  completed     boolean not null default false,
  completed_at  timestamptz,
  unique (user_id, step_key)
);

-- ----------------------------------------------------------------------------
-- 5. WINS  (Win Wall — community wall: everyone reads, you post/delete your own)
-- ----------------------------------------------------------------------------
create table if not exists public.wins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists wins_created_idx on public.wins (created_at desc);

-- ============================================================================
--  ROW LEVEL SECURITY
--  RLS is OFF by default in Postgres -> turning it on means "deny all" until a
--  policy explicitly allows. Each policy below scopes access to auth.uid().
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.saves    enable row level security;
alter table public.progress enable row level security;
alter table public.wins     enable row level security;

-- profiles: a user sees/edits only their own row -----------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- messages: own rows only ----------------------------------------------------
drop policy if exists "messages_all_own" on public.messages;
create policy "messages_all_own" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- saves: own rows only -------------------------------------------------------
drop policy if exists "saves_all_own" on public.saves;
create policy "saves_all_own" on public.saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- progress: own rows only ----------------------------------------------------
drop policy if exists "progress_all_own" on public.progress;
create policy "progress_all_own" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- wins: COMMUNITY WALL -> any signed-in user can read all wins,
--       but can only insert/update/delete their own.
drop policy if exists "wins_select_all" on public.wins;
create policy "wins_select_all" on public.wins
  for select using (auth.role() = 'authenticated');

drop policy if exists "wins_insert_own" on public.wins;
create policy "wins_insert_own" on public.wins
  for insert with check (auth.uid() = user_id);

drop policy if exists "wins_update_own" on public.wins;
create policy "wins_update_own" on public.wins
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "wins_delete_own" on public.wins;
create policy "wins_delete_own" on public.wins
  for delete using (auth.uid() = user_id);

-- ============================================================================
--  TRIGGERS
-- ============================================================================

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.updated_at fresh on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================================
--  LICENSE-KEY PROTECTION SYSTEM
--  Added 2026-06-15. These tables are touched ONLY by the backend using the
--  Supabase service-role key. RLS is enabled with NO policies, so the public
--  anon/authenticated client (the browser) can never read or write them — this
--  is what guarantees license keys are never exposed in frontend JavaScript.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6. LICENSES  (one row per generated key; format TM3-XXXX-XXXX-XXXX)
-- ----------------------------------------------------------------------------
create table if not exists public.licenses (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,                 -- TM3-XXXX-XXXX-XXXX
  email       text,                                 -- purchase email this key is for
  used        boolean not null default false,
  used_at     timestamptz,
  revoked     boolean not null default false,
  revoked_at  timestamptz,
  order_id    text,                                 -- ClickFunnels order reference
  created_at  timestamptz not null default now()
);
create index if not exists licenses_email_idx on public.licenses (lower(email));
create index if not exists licenses_created_idx on public.licenses (created_at desc);

-- ----------------------------------------------------------------------------
-- 7. APPROVED_BUYERS  (emails allowed to register; populated by webhook/admin)
-- ----------------------------------------------------------------------------
create table if not exists public.approved_buyers (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  purchase_date timestamptz,
  order_id      text,
  license_key   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists approved_buyers_email_idx on public.approved_buyers (lower(email));

-- ----------------------------------------------------------------------------
-- 8. ADMIN_USERS  (admin-panel logins; separate from app auth.users)
--    password_hash is a bcrypt hash. Seeded from ADMIN_EMAIL/ADMIN_PASSWORD.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 9. WEBHOOK_LOGS  (every ClickFunnels webhook attempt, for admin diagnostics)
--    status: 'success' | 'failed' | 'skipped' | 'rejected'
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_logs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'clickfunnels',
  email       text,
  order_id    text,
  status      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists webhook_logs_created_idx on public.webhook_logs (created_at desc);

-- Permanently link each activated account to the license key it used.
alter table public.profiles add column if not exists license_key text;

-- ============================================================================
--  PROJECTS  (Added 2026-06-16)
--  Named workspaces — different products an owner is building. Each project
--  carries its own copy of the 17 Yellow Brick Road steps (completion + the
--  work saved in each step). The global `progress` table above is unchanged
--  and still drives the main My-Progress checklist + sidebar slider.
-- ============================================================================

-- 10. PROJECTS  (one row per named project)
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

-- 11. PROJECT_STEPS  (per-project copy of the 17 steps: completion + saved work)
--     step_key is one of ybr-1 .. ybr-17 (see client/src/lib/ybrSteps.js).
create table if not exists public.project_steps (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  step_key     text not null,
  completed    boolean not null default false,
  completed_at timestamptz,
  content      text,                 -- the Tin Man's auto-saved output for this step
  notes        text,                 -- the owner's own notes (never overwritten by the walkthrough)
  updated_at   timestamptz not null default now(),
  unique (project_id, step_key)
);
create index if not exists project_steps_project_idx on public.project_steps (project_id);

-- Add the owner-notes column to any project_steps table created before it existed.
alter table public.project_steps
  add column if not exists notes text;

-- Which project the guided walkthrough currently auto-saves into (null = none).
alter table public.profiles
  add column if not exists active_project_id uuid references public.projects(id) on delete set null;

-- Tie messages to a project thread now that projects exists (null = General
-- thread). Deleting a project clears its chat thread along with it.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'messages_project_id_fkey'
      and table_name = 'messages'
  ) then
    alter table public.messages
      add constraint messages_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;
end $$;

-- own rows only ---------------------------------------------------------------
alter table public.projects      enable row level security;
alter table public.project_steps enable row level security;

drop policy if exists "projects_all_own" on public.projects;
create policy "projects_all_own" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "project_steps_all_own" on public.project_steps;
create policy "project_steps_all_own" on public.project_steps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep projects.updated_at fresh on every update.
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Keep project_steps.updated_at fresh on every update.
drop trigger if exists project_steps_set_updated_at on public.project_steps;
create trigger project_steps_set_updated_at
  before update on public.project_steps
  for each row execute function public.set_updated_at();

-- Lock these tables down: RLS on, and intentionally NO policies. The browser
-- (anon/authenticated) is therefore denied all access; the backend uses the
-- service-role key, which bypasses RLS.
alter table public.licenses        enable row level security;
alter table public.approved_buyers enable row level security;
alter table public.admin_users     enable row level security;
alter table public.webhook_logs    enable row level security;

-- ============================================================================
--  PRICING  (Added 2026-06-16)
--  shop_rate: one row per user (their cost basis behind every quote).
--  quotes:    saved job estimates, optionally tied to a project.
--  Both are own-rows-only via RLS, same pattern as projects/project_steps.
-- ============================================================================

-- 12. SHOP_RATE  (one row per user — user_id is the PK so upserts are 1:1)
create table if not exists public.shop_rate (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  mode                  text not null default 'cost' check (mode in ('cost','income')),
  -- Mode A: cost build-up
  wage_hr               numeric,
  burden_pct            numeric default 30,
  machine_monthly_cost  numeric,
  overhead_monthly      numeric,
  work_hours_week       numeric default 40,
  billable_pct          numeric default 65,
  margin_pct            numeric default 32,
  -- Mode B: income goal
  target_income_yr      numeric,
  annual_expenses       numeric,
  work_weeks_yr         numeric default 50,
  -- per-user job-calc defaults (editable on the Job Rates panel)
  material_markup       numeric default 2,
  scrap_pct             numeric default 7,
  job_minimum           numeric default 125,
  default_rate_hr       numeric default 125,
  finishing_rate_sqft   numeric default 8,
  -- per-thickness cut/pierce + sq-ft rate table: [{value,label,cost_per_inch,cost_per_pierce,sqft_price}]
  thickness_rates       jsonb,
  -- legacy fallback cut rates (superseded by thickness_rates)
  cost_per_pierce       numeric default 0.15,
  cost_per_inch         numeric default 0.20,
  -- cached result (computed client-side, stored so the AI + sidebar read it cheaply)
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
  -- inputs (stored so a quote can be re-opened / cloned)
  method          text default 'detailed',   -- 'detailed' | 'sqft'
  thickness       text,
  square_feet     numeric,
  finishing       boolean default false,
  finish_sqft     numeric,
  material_cost   numeric,
  pierces         integer,
  cut_inches      numeric,
  run_minutes     numeric,
  cad_hours       numeric,
  setup_hours     numeric,
  quantity        integer default 1,
  -- snapshot of the rate used (so editing the shop rate never rewrites old quotes)
  rate_hr_used    numeric,
  -- computed outputs
  unit_price      numeric,
  total_price     numeric,
  job_profit      numeric,
  status          text not null default 'draft'
                  check (status in ('draft','sent','won','lost')),
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

-- keep updated_at fresh
drop trigger if exists shop_rate_set_updated_at on public.shop_rate;
create trigger shop_rate_set_updated_at
  before update on public.shop_rate
  for each row execute function public.set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ============================================================================
--  Done. Tables: profiles, messages, saves, progress, wins,
--                projects, project_steps, shop_rate, quotes,
--                licenses, approved_buyers, admin_users, webhook_logs.
-- ============================================================================
