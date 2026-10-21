-- CrowdQuiz core schema
-- Tables, constraints and indexes. Functions live in later migrations.
-- All timestamps are timestamptz (stored in UTC).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
comment on schema private is 'Internal helpers. Not exposed through the API.';

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.game_mode as enum ('multiple_choice', 'color_buzzer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.quiz_status as enum ('draft', 'ready');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Session state machine. See docs/game-engine.md for allowed transitions.
  create type public.session_status as enum (
    'lobby', 'countdown', 'question_open', 'reveal', 'leaderboard', 'paused', 'finished', 'aborted'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.round_status as enum ('open', 'closed', 'voided');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Accounts and authorization
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  disabled boolean not null default false,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform administrators. Rows can only be created with database-owner
-- privileges (SQL editor / psql / service role). See docs/admin-bootstrap.md.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  note text
);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the normalized code. The plaintext is shown once at creation.
  code_hash text not null unique,
  -- First characters of the code so admins can recognise it in lists.
  code_hint text not null,
  plan text not null default 'standard' check (plan ~ '^[a-z0-9_]{1,32}$'),
  features jsonb not null default '{}'::jsonb,
  access_duration interval not null check (access_duration > interval '0'),
  max_redemptions integer not null default 1 check (max_redemptions between 1 and 100000),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  max_sessions integer check (max_sessions is null or max_sessions > 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint access_codes_limit check (redemption_count <= max_redemptions)
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null default 'standard',
  features jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- Where the entitlement came from. 'stripe' is reserved for future billing.
  source text not null check (source in ('access_code', 'admin', 'stripe')),
  source_ref uuid,
  max_sessions integer check (max_sessions is null or max_sessions > 0),
  created_at timestamptz not null default now(),
  constraint entitlements_window check (expires_at > starts_at)
);
create index if not exists entitlements_user_idx on public.entitlements (user_id, expires_at desc);

create table if not exists public.access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.access_codes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement_id uuid references public.entitlements (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);
create index if not exists redemptions_user_idx on public.access_code_redemptions (user_id);

-- ---------------------------------------------------------------------------
-- Quiz content
-- ---------------------------------------------------------------------------
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled quiz' check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  mode public.game_mode not null,
  status public.quiz_status not null default 'draft',
  -- Default session settings for this quiz (validated when a session is launched).
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_owner_idx on public.quizzes (owner_id, updated_at desc);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  position integer not null check (position >= 0),
  -- 'text' today; the column leaves room for image/audio questions later.
  kind text not null default 'text' check (kind in ('text')),
  prompt text not null default '' check (char_length(prompt) <= 300),
  choices text[] not null default array['', '', '', '']::text[],
  correct_index smallint check (correct_index between 0 and 3),
  -- Optional per-question timer override for Multiple Choice.
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 5 and 120),
  media jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_four_choices check (array_length(choices, 1) = 4),
  constraint questions_choice_length check (
    char_length(choices[1]) <= 120 and char_length(choices[2]) <= 120
    and char_length(choices[3]) <= 120 and char_length(choices[4]) <= 120
  ),
  constraint questions_position_unique unique (quiz_id, position) deferrable initially immediate
);
create index if not exists questions_quiz_idx on public.questions (quiz_id, position);

-- ---------------------------------------------------------------------------
-- Live sessions
-- ---------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  quiz_id uuid references public.quizzes (id) on delete set null,
  quiz_title text not null,
  mode public.game_mode not null,
  settings jsonb not null,
  status public.session_status not null default 'lobby',
  -- Short code typed by players who cannot scan. Unique among live sessions.
  room_code text not null check (room_code ~ '^[A-Z2-9]{6}$'),
  -- Unguessable token embedded in the QR join URL.
  join_token text not null unique check (char_length(join_token) >= 22),
  -- Unguessable token for the read-only projector view.
  projector_token text not null unique check (char_length(projector_token) >= 22),
  question_count integer not null check (question_count > 0),
  current_position integer,
  current_round_id uuid,
  question_started_at timestamptz,
  question_deadline timestamptz,
  -- When the current timed phase (countdown / reveal / leaderboard) ends.
  phase_ends_at timestamptz,
  paused_from public.session_status,
  paused_remaining_ms integer,
  paused_at timestamptz,
  -- Incremented on every state change. Used for idempotent host commands
  -- and so clients can tell whether their copy of the state is stale.
  state_version integer not null default 1,
  final_results jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists game_sessions_host_idx on public.game_sessions (host_id, created_at desc);
create unique index if not exists game_sessions_live_room_code_idx
  on public.game_sessions (room_code) where status not in ('finished', 'aborted');
create index if not exists game_sessions_due_idx
  on public.game_sessions (status) where status in ('countdown', 'question_open', 'reveal', 'leaderboard');

-- Snapshot of the quiz questions taken at launch. Editing the quiz later
-- never changes a session that already exists.
create table if not exists public.session_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null,
  choices text[] not null check (array_length(choices, 1) = 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  time_limit_seconds integer,
  source_question_id uuid,
  unique (session_id, position)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  -- Lower-cased, whitespace-collapsed name used for uniqueness.
  name_key text not null,
  -- sha256 of the secret held by the player's device. Never the secret itself.
  secret_hash text not null,
  removed_at timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, secret_hash),
  unique (session_id, name_key)
);
create index if not exists participants_session_idx on public.participants (session_id, joined_at);

-- One row per time a question is opened. Replaying a question voids the
-- previous round and opens a new attempt, so points are never duplicated.
create table if not exists public.session_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  question_id uuid not null references public.session_questions (id) on delete cascade,
  position integer not null,
  attempt integer not null default 1,
  status public.round_status not null default 'open',
  opened_at timestamptz not null default clock_timestamp(),
  deadline timestamptz,
  closed_at timestamptz,
  close_reason text check (close_reason in ('deadline', 'winner', 'all_wrong', 'host_closed', 'skipped', 'replayed', 'ended')),
  winner_participant_id uuid references public.participants (id) on delete set null,
  winner_answer_id uuid,
  winner_choice smallint,
  unique (session_id, position, attempt)
);
create index if not exists session_rounds_session_idx on public.session_rounds (session_id, position);
-- At most one open round per session.
create unique index if not exists session_rounds_one_open_idx
  on public.session_rounds (session_id) where status = 'open';

alter table public.game_sessions
  drop constraint if exists game_sessions_current_round_fk;
alter table public.game_sessions
  add constraint game_sessions_current_round_fk
  foreign key (current_round_id) references public.session_rounds (id) on delete set null;

-- Every answer or buzzer press accepted by the server.
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  round_id uuid not null references public.session_rounds (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  attempt_no integer not null default 1 check (attempt_no >= 1),
  choice_index smallint not null check (choice_index between 0 and 3),
  is_correct boolean not null,
  -- Client-generated idempotency key: retries of the same tap are recognised.
  submission_id uuid not null,
  accepted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz,
  unique (round_id, participant_id, attempt_no),
  unique (participant_id, submission_id)
);
create index if not exists answers_round_idx on public.answers (round_id, accepted_at);

-- Scoring ledger. Totals are always derived from these rows (excluding
-- voided rounds), so every point can be traced to a question and a reason.
create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  round_id uuid not null references public.session_rounds (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  answer_id uuid references public.answers (id) on delete set null,
  points integer not null,
  reason text not null check (reason in ('correct', 'buzzer_win')),
  base_points integer not null default 0,
  bonus_points integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  -- Idempotency: one award per player per round.
  unique (round_id, participant_id)
);
create index if not exists score_events_session_idx on public.score_events (session_id, participant_id);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('host', 'admin', 'player', 'system')),
  actor_id uuid,
  session_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_session_idx on public.audit_log (session_id) where session_id is not null;

create table if not exists private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- updated_at maintenance
create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function private.touch_updated_at();
drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before update on public.questions
  for each row execute function private.touch_updated_at();
drop trigger if exists sessions_touch on public.game_sessions;
create trigger sessions_touch before update on public.game_sessions
  for each row execute function private.touch_updated_at();
