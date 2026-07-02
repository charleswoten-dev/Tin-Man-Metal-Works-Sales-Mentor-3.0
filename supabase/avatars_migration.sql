-- ============================================================================
--  MY DREAM BUYERS  (saved customer avatars)  — added 2026-07-02
--  A user-level library of reusable dream-buyer avatars, independent of any
--  project. Run ONCE in the Supabase dashboard → SQL Editor → New query → Run.
--  Safe to re-run.
-- ============================================================================

create table if not exists public.avatars (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  content     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists avatars_user_idx on public.avatars (user_id, created_at desc);

-- Own rows only (same pattern as projects/quotes).
alter table public.avatars enable row level security;

drop policy if exists "avatars_all_own" on public.avatars;
create policy "avatars_all_own" on public.avatars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh on every update (reuses the existing helper function).
drop trigger if exists avatars_set_updated_at on public.avatars;
create trigger avatars_set_updated_at
  before update on public.avatars
  for each row execute function public.set_updated_at();
