-- Row-level security and privileges.
--
-- Model:
--   * anon (players, projectors): no direct table access at all. They use the
--     SECURITY DEFINER RPCs, which check the player secret / projector token
--     and return only what each screen needs.
--   * authenticated (hosts): may read and edit their own quizzes directly;
--     may read their own sessions; every session mutation goes through RPCs.
--   * Admin data is only reachable through admin_* RPCs that check admin_users.

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.access_codes enable row level security;
alter table public.entitlements enable row level security;
alter table public.access_code_redemptions enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.session_questions enable row level security;
alter table public.participants enable row level security;
alter table public.session_rounds enable row level security;
alter table public.answers enable row level security;
alter table public.score_events enable row level security;
alter table public.audit_log enable row level security;

-- Start from nothing, then grant precisely.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Profiles: read own, update display name only.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Entitlements and redemptions: read own.
grant select on public.entitlements, public.access_code_redemptions to authenticated;
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists redemptions_select_own on public.access_code_redemptions;
create policy redemptions_select_own on public.access_code_redemptions for select to authenticated
  using (user_id = (select auth.uid()));

-- Quizzes: full control of own rows.
grant select, insert, delete on public.quizzes to authenticated;
grant update (title, description, status, settings) on public.quizzes to authenticated;
drop policy if exists quizzes_owner_all on public.quizzes;
create policy quizzes_owner_all on public.quizzes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Questions: through ownership of the parent quiz.
grant select, delete on public.questions to authenticated;
grant insert (quiz_id, position, kind, prompt, choices, correct_index, time_limit_seconds, media) on public.questions to authenticated;
grant update (prompt, choices, correct_index, time_limit_seconds, media) on public.questions to authenticated;
drop policy if exists questions_owner_all on public.questions;
create policy questions_owner_all on public.questions for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = (select auth.uid())));

-- Sessions and gameplay records: hosts read their own (no direct writes).
grant select on public.game_sessions, public.session_questions, public.participants,
  public.session_rounds, public.answers, public.score_events to authenticated;

drop policy if exists sessions_host_select on public.game_sessions;
create policy sessions_host_select on public.game_sessions for select to authenticated
  using (host_id = (select auth.uid()));

drop policy if exists session_questions_host_select on public.session_questions;
create policy session_questions_host_select on public.session_questions for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = session_id and g.host_id = (select auth.uid())));
drop policy if exists participants_host_select on public.participants;
create policy participants_host_select on public.participants for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = session_id and g.host_id = (select auth.uid())));
drop policy if exists rounds_host_select on public.session_rounds;
create policy rounds_host_select on public.session_rounds for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = session_id and g.host_id = (select auth.uid())));
drop policy if exists answers_host_select on public.answers;
create policy answers_host_select on public.answers for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = session_id and g.host_id = (select auth.uid())));
drop policy if exists score_events_host_select on public.score_events;
create policy score_events_host_select on public.score_events for select to authenticated
  using (exists (select 1 from public.game_sessions g where g.id = session_id and g.host_id = (select auth.uid())));

-- The participants table holds secret hashes; hide that column from hosts.
revoke select on public.participants from authenticated;
grant select (id, session_id, display_name, removed_at, joined_at, last_seen_at) on public.participants to authenticated;
-- Hide the session tokens' table columns? Hosts own the session and need the
-- join/projector tokens to show the QR code, so they stay readable to the owner.

-- admin_users, access_codes, audit_log: no grants (RPC only).

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default. Make it explicit and minimal.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Player / projector API (no account).
grant execute on function public.server_time() to anon, authenticated;
grant execute on function public.get_join_info(text) to anon, authenticated;
grant execute on function public.resolve_room_code(text) to anon, authenticated;
grant execute on function public.join_session(text, text, text) to anon, authenticated;
grant execute on function public.player_state(uuid, text) to anon, authenticated;
grant execute on function public.submit_answer(uuid, text, uuid, integer, uuid) to anon, authenticated;
grant execute on function public.tick_session(uuid) to anon, authenticated;
grant execute on function public.projector_state(text) to anon, authenticated;

-- Host API (signed in).
grant execute on function public.create_session(uuid, jsonb) to authenticated;
grant execute on function public.host_state(uuid) to authenticated;
grant execute on function public.host_command(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.delete_session(uuid) to authenticated;
grant execute on function public.session_results(uuid) to authenticated;
grant execute on function public.add_question(uuid, integer) to authenticated;
grant execute on function public.duplicate_question(uuid) to authenticated;
grant execute on function public.delete_question(uuid) to authenticated;
grant execute on function public.reorder_questions(uuid, uuid[]) to authenticated;
grant execute on function public.duplicate_quiz(uuid) to authenticated;
grant execute on function public.quiz_issues(uuid) to authenticated;
grant execute on function public.my_entitlement() to authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;

-- Admin API (checked again inside every function).
grant execute on function public.admin_create_access_code(integer, integer, timestamptz, text, text, integer, text) to authenticated;
grant execute on function public.admin_list_access_codes() to authenticated;
grant execute on function public.admin_revoke_access_code(uuid) to authenticated;
grant execute on function public.admin_list_hosts(text) to authenticated;
grant execute on function public.admin_set_host_disabled(uuid, boolean, text) to authenticated;
grant execute on function public.admin_grant_entitlement(uuid, integer, text) to authenticated;
grant execute on function public.admin_revoke_entitlements(uuid) to authenticated;
grant execute on function public.admin_list_sessions(boolean) to authenticated;
grant execute on function public.admin_end_session(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_audit_log(integer) to authenticated;

-- Supabase's auth helpers must stay callable (used inside RLS policies).
-- They live in the auth schema and are unaffected by the revokes above.

-- Future functions in public are not executable by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
