-- Internal helpers used by the game engine. All live in the private schema,
-- which is not exposed through the Supabase API.

-- Raise an application error. Clients map the 'CQ:<code>' message to a
-- friendly explanation (see packages/shared/src/errors.ts).
create or replace function private.raise(p_code text, p_detail text default null)
returns void language plpgsql as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'CQ:' || p_code,
    detail = coalesce(p_detail, '');
end $$;

-- A "soft" error is returned as {"error": "<code>"} instead of raised, so
-- the transaction still commits. Used where a failed attempt must still be
-- counted (rate limits) or where work done first must persist (e.g. a late
-- answer that closes an expired question). Clients treat it like an error.
create or replace function private.soft_error(p_code text) returns jsonb
language sql immutable as $$ select jsonb_build_object('error', p_code); $$;

create or replace function private.sha256_hex(p text) returns text
language sql immutable strict as $$
  select encode(pg_catalog.sha256(convert_to(p, 'UTF8')), 'hex');
$$;

-- URL-safe random token from a cryptographically secure source.
create or replace function private.random_token(p_bytes integer default 24) returns text
language sql volatile as $$
  select replace(replace(replace(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+', '-'), '/', '_'), '=', '');
$$;

-- Random string over an unambiguous alphabet (no 0/O/1/I/L).
create or replace function private.random_code(p_len integer) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_len);
  out text := '';
begin
  for i in 0 .. p_len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

-- Best-effort client IP from the API gateway headers (used for rate limits only).
create or replace function private.client_ip() returns text
language plpgsql stable as $$
declare
  h json;
  v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return 'unknown';
  end;
  if h is null then return 'unknown'; end if;
  v := coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1), h ->> 'x-real-ip');
  return coalesce(nullif(trim(v), ''), 'unknown');
end $$;

-- Fixed-window rate limiter. Raises CQ:rate_limited when the bucket is full.
create or replace function private.rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns void language plpgsql as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then
    perform private.raise('rate_limited');
  end if;
end $$;

create or replace function private.audit(
  p_actor_type text, p_actor_id uuid, p_session_id uuid, p_action text, p_details jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into public.audit_log (actor_type, actor_id, session_id, action, details)
  values (p_actor_type, p_actor_id, p_session_id, p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Tell connected clients that something changed. The message carries no
-- private data; clients fetch the authoritative state through an RPC.
-- Uses Supabase Realtime broadcast-from-database when it is available.
create or replace function private.broadcast(p_session_id uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  begin
    perform realtime.send(
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('at', clock_timestamp()),
      p_event,
      'session:' || p_session_id::text,
      false
    );
  exception
    when undefined_function or invalid_schema_name or undefined_table then
      null; -- Realtime is not installed (plain Postgres test database).
  end;
end $$;

create or replace function private.json_int(p jsonb, p_default integer, p_min integer, p_max integer)
returns integer language sql immutable as $$
  select case
    when jsonb_typeof(p) = 'number' then greatest(p_min, least(p_max, round((p #>> '{}')::numeric)::integer))
    else p_default
  end;
$$;

create or replace function private.json_bool(p jsonb, p_default boolean)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(p) = 'boolean' then (p #>> '{}')::boolean else p_default end;
$$;

-- Fill defaults and clamp every session setting to a safe range.
-- Mirrors normalizeSessionSettings() in packages/shared.
create or replace function private.normalize_settings(p_mode public.game_mode, p jsonb)
returns jsonb language plpgsql immutable as $$
declare
  is_mc boolean := p_mode = 'multiple_choice';
begin
  p := coalesce(p, '{}'::jsonb);
  return jsonb_build_object(
    'timeLimitSeconds',     private.json_int(p -> 'timeLimitSeconds', 15, 5, 120),
    'countdownSeconds',     private.json_int(p -> 'countdownSeconds', 3, 0, 10),
    'revealSeconds',        private.json_int(p -> 'revealSeconds', 5, 2, 30),
    'leaderboardSeconds',   private.json_int(p -> 'leaderboardSeconds', 5, 2, 30),
    'showLeaderboard',      private.json_bool(p -> 'showLeaderboard', true),
    'autoAdvance',          private.json_bool(p -> 'autoAdvance', is_mc),
    'allowAnswerChange',    private.json_bool(p -> 'allowAnswerChange', false),
    'allowLateJoin',        private.json_bool(p -> 'allowLateJoin', true),
    'pointsCorrect',        private.json_int(p -> 'pointsCorrect', 1, 0, 1000),
    'speedBonus',           private.json_bool(p -> 'speedBonus', false),
    'speedBonusMaxPoints',  private.json_int(p -> 'speedBonusMaxPoints', 1, 0, 1000),
    'buzzerLockout',        private.json_bool(p -> 'buzzerLockout', true),
    'buzzerTimeLimitSeconds', case
      when jsonb_typeof(p -> 'buzzerTimeLimitSeconds') = 'number'
        then private.json_int(p -> 'buzzerTimeLimitSeconds', 30, 5, 300)
      else null end,
    'allowReplay',          private.json_bool(p -> 'allowReplay', true),
    'showChoicesOnPhone',   private.json_bool(p -> 'showChoicesOnPhone', is_mc),
    'maxPlayers',           private.json_int(p -> 'maxPlayers', 100, 2, 500)
  );
end $$;

-- Points for one answer. Mirrors scoreMultipleChoiceAnswer() in packages/shared.
create or replace function private.mc_points(
  p_settings jsonb, p_is_correct boolean, p_accepted_at timestamptz, p_started_at timestamptz, p_deadline timestamptz
) returns table (base_points integer, bonus_points integer)
language plpgsql immutable as $$
declare
  v_base integer := (p_settings ->> 'pointsCorrect')::integer;
  v_bonus integer := 0;
  v_total_ms numeric;
  v_left_ms numeric;
begin
  if not p_is_correct then
    base_points := 0; bonus_points := 0; return next; return;
  end if;
  if (p_settings ->> 'speedBonus')::boolean and p_deadline is not null and p_started_at is not null then
    v_total_ms := extract(epoch from (p_deadline - p_started_at)) * 1000;
    v_left_ms := greatest(0, extract(epoch from (p_deadline - p_accepted_at)) * 1000);
    if v_total_ms > 0 then
      v_bonus := floor((p_settings ->> 'speedBonusMaxPoints')::numeric * least(1, v_left_ms / v_total_ms));
    end if;
  end if;
  base_points := v_base; bonus_points := v_bonus;
  return next;
end $$;

-- Display-name rules. Mirrors normalizeDisplayName() in packages/shared.
create or replace function private.normalize_name(p text) returns text
language plpgsql immutable as $$
declare
  v text;
begin
  if p is null then perform private.raise('invalid_name', 'missing'); end if;
  -- Reject control and invisible formatting characters outright.
  if p ~ '[[:cntrl:]]' or p ~ '[​-‏‪-‮⁠-⁤﻿]' then
    perform private.raise('invalid_name', 'control_characters');
  end if;
  v := regexp_replace(btrim(p), '\s+', ' ', 'g');
  if char_length(v) < 1 then perform private.raise('invalid_name', 'empty'); end if;
  if char_length(v) > 24 then perform private.raise('invalid_name', 'too_long'); end if;
  return v;
end $$;

create or replace function private.valid_secret(p text) returns boolean
language sql immutable as $$
  select p is not null and p ~ '^[A-Za-z0-9_-]{32,128}$';
$$;

create or replace function private.is_admin(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (select 1 from public.admin_users a where a.user_id = p_uid);
$$;

-- Ensure the caller is a signed-in host whose account is not disabled.
create or replace function private.require_host() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_disabled boolean;
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  select p.disabled into v_disabled from public.profiles p where p.id = v_uid;
  if coalesce(v_disabled, false) then perform private.raise('account_disabled'); end if;
  return v_uid;
end $$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
begin
  if not private.is_admin(v_uid) then perform private.raise('forbidden'); end if;
  return v_uid;
end $$;

-- Quiz validation. Mirrors validateQuizForPlay() in packages/shared.
create or replace function private.quiz_problems(p_quiz_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  problems text[] := '{}';
  q record;
  n integer := 0;
begin
  for q in select * from public.questions where quiz_id = p_quiz_id order by position loop
    n := n + 1;
    if btrim(q.prompt) = '' then problems := problems || format('Question %s needs a prompt', n); end if;
    if btrim(q.choices[1]) = '' or btrim(q.choices[2]) = '' or btrim(q.choices[3]) = '' or btrim(q.choices[4]) = '' then
      problems := problems || format('Question %s needs four answer choices', n);
    end if;
    if q.correct_index is null then problems := problems || format('Question %s needs a correct answer', n); end if;
  end loop;
  if n = 0 then problems := problems || 'Add at least one question'::text; end if;
  return problems;
end $$;
