-- ============================================================================
--  Tin Man — CHAT THREADS migration (run ONCE in Supabase → SQL Editor).
--  Gives each project its own chat thread. messages.project_id = null is the
--  shared "General" thread; a uuid ties the message to that project's thread.
--  Safe to re-run (add column if not exists).
-- ============================================================================

-- 1. tie each message to a project thread (null = General) -------------------
alter table public.messages
  add column if not exists project_id uuid
    references public.projects(id) on delete cascade;

-- 2. fast per-thread history lookups ----------------------------------------
create index if not exists messages_user_project_created_idx
  on public.messages (user_id, project_id, created_at);

-- 3. start fresh: wipe existing chat history (per owner's choice) ------------
--    Each project + the General thread begins empty.
delete from public.messages;
