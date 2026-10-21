-- Public gameplay API (exposed as Supabase RPCs).
-- Players and projectors are not Supabase users: they authenticate every call
-- with an unguessable secret (player secret / projector token).

create or replace function public.server_time() returns timestamptz
language sql volatile as $$ select clock_timestamp(); $$;

-- ---------------------------------------------------------------------------
-- Session creation (host)
-- ---------------------------------------------------------------------------
create or replace function private.assert_can_host(p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.entitlements;
  v_used integer;
begin
  if private.is_admin(p_uid) then return; end if;
  select * into e from public.entitlements
  where user_id = p_uid and status = 'active' and starts_at <= now() and expires_at > now()
  order by expires_at desc limit 1;
  if e.id is null then perform private.raise('no_entitlement'); end if;
  if e.max_sessions is not null then
    select count(*) into v_used from public.game_sessions
    where host_id = p_uid and created_at >= e.starts_at and status <> 'aborted';
    if v_used >= e.max_sessions then perform private.raise('session_limit_reached'); end if;
  end if;
end $$;

create or replace function public.create_session(p_quiz_id uuid, p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  qz public.quizzes;
  v_problems text[];
  v_settings jsonb;
  v_sid uuid;
  v_count integer;
  v_room text;
  v_join text := private.random_token(18);
  v_proj text := private.random_token(18);
  v_live integer;
begin
  perform private.rate_limit('create_session:' || v_uid, 20, 600);
  select * into qz from public.quizzes where id = p_quiz_id and owner_id = v_uid;
  if qz.id is null then perform private.raise('not_found'); end if;

  perform private.assert_can_host(v_uid);

  v_problems := private.quiz_problems(p_quiz_id);
  if array_length(v_problems, 1) > 0 then
    perform private.raise('quiz_invalid', array_to_string(v_problems, '; '));
  end if;

  -- Abandoned sessions (no activity for 6 hours) are closed automatically.
  update public.game_sessions set status = 'aborted', ended_at = now()
  where host_id = v_uid and status not in ('finished', 'aborted') and updated_at < now() - interval '6 hours';
  select count(*) into v_live from public.game_sessions
  where host_id = v_uid and status not in ('finished', 'aborted');
  if v_live >= 10 then perform private.raise('too_many_live_sessions'); end if;

  v_settings := private.normalize_settings(qz.mode, coalesce(qz.settings, '{}'::jsonb) || coalesce(p_settings, '{}'::jsonb));
  select count(*) into v_count from public.questions where quiz_id = p_quiz_id;

  for i in 1 .. 10 loop
    v_room := private.random_code(6);
    begin
      insert into public.game_sessions (host_id, quiz_id, quiz_title, mode, settings, room_code, join_token, projector_token, question_count)
      values (v_uid, qz.id, qz.title, qz.mode, v_settings, v_room, v_join, v_proj, v_count)
      returning id into v_sid;
      exit;
    exception when unique_violation then
      if i = 10 then perform private.raise('internal', 'could not allocate room code'); end if;
    end;
  end loop;

  insert into public.session_questions (session_id, position, prompt, choices, correct_index, time_limit_seconds, source_question_id)
  select v_sid, (row_number() over (order by q.position) - 1)::integer, btrim(q.prompt),
    array[btrim(q.choices[1]), btrim(q.choices[2]), btrim(q.choices[3]), btrim(q.choices[4])],
    q.correct_index, q.time_limit_seconds, q.id
  from public.questions q where q.quiz_id = p_quiz_id;

  perform private.audit('host', v_uid, v_sid, 'session.created', jsonb_build_object('quizId', qz.id, 'questions', v_count));
  return jsonb_build_object('sessionId', v_sid, 'roomCode', v_room, 'joinToken', v_join, 'projectorToken', v_proj);
end $$;

-- ---------------------------------------------------------------------------
-- Joining (players)
-- ---------------------------------------------------------------------------
create or replace function private.joinable_reason(s public.game_sessions) returns text
language sql stable as $$
  select case
    when s.status in ('finished', 'aborted') then 'session_ended'
    when s.status <> 'lobby' and not (s.settings ->> 'allowLateJoin')::boolean then 'late_join_disabled'
    else null end;
$$;

create or replace function public.get_join_info(p_join_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
begin
  perform private.rate_limit('join_info:' || private.client_ip(), 300, 60);
  select * into s from public.game_sessions where join_token = p_join_token;
  if s.id is null then perform private.raise('session_not_found'); end if;
  return jsonb_build_object(
    'sessionId', s.id, 'title', s.quiz_title, 'mode', s.mode, 'status', s.status,
    'joinable', private.joinable_reason(s) is null, 'reason', private.joinable_reason(s)
  );
end $$;

create or replace function public.resolve_room_code(p_room_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_room_code, ''), '[^A-Za-z0-9]', '', 'g'));
  s public.game_sessions;
begin
  perform private.rate_limit('room_code:' || private.client_ip(), 60, 60);
  -- Soft errors so failed guesses still count against the rate limit.
  if v_code !~ '^[A-Z2-9]{6}$' then return private.soft_error('session_not_found'); end if;
  select * into s from public.game_sessions where room_code = v_code and status not in ('finished', 'aborted');
  if s.id is null then return private.soft_error('session_not_found'); end if;
  return jsonb_build_object('joinToken', s.join_token, 'sessionId', s.id, 'title', s.quiz_title);
end $$;

-- Join (or rejoin) a session. The device generates p_player_secret and keeps
-- it; repeating the call with the same secret returns the same participant,
-- so accidental double taps or reconnects never create duplicate players.
create or replace function public.join_session(p_join_token text, p_display_name text, p_player_secret text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
  p public.participants;
  v_name text;
  v_hash text;
  v_reason text;
  v_count integer;
begin
  perform private.rate_limit('join:' || private.client_ip(), 200, 60);
  if not private.valid_secret(p_player_secret) then perform private.raise('invalid_player'); end if;
  v_hash := private.sha256_hex(p_player_secret);

  select * into s from public.game_sessions where join_token = p_join_token for update;
  if s.id is null then perform private.raise('session_not_found'); end if;
  perform private.rate_limit('join_session:' || s.id, 600, 60);

  select * into p from public.participants where session_id = s.id and secret_hash = v_hash;
  if p.id is not null then
    if p.removed_at is not null then perform private.raise('player_removed'); end if;
    return jsonb_build_object('participantId', p.id, 'sessionId', s.id, 'displayName', p.display_name, 'rejoined', true);
  end if;

  v_reason := private.joinable_reason(s);
  if v_reason is not null then perform private.raise(v_reason); end if;

  v_name := private.normalize_name(p_display_name);
  select count(*) into v_count from public.participants where session_id = s.id and removed_at is null;
  if v_count >= (s.settings ->> 'maxPlayers')::integer then perform private.raise('session_full'); end if;
  if exists (select 1 from public.participants where session_id = s.id and name_key = lower(v_name)) then
    perform private.raise('name_taken');
  end if;

  insert into public.participants (session_id, display_name, name_key, secret_hash)
  values (s.id, v_name, lower(v_name), v_hash)
  returning * into p;

  perform private.broadcast(s.id, 'roster', jsonb_build_object('count', v_count + 1));
  return jsonb_build_object('participantId', p.id, 'sessionId', s.id, 'displayName', p.display_name, 'rejoined', false);
end $$;

-- ---------------------------------------------------------------------------
-- Clock-driven progression
-- ---------------------------------------------------------------------------

-- Any client may ask the server to apply transitions that are due. The
-- server only acts on its own clock, so calling this early does nothing.
create or replace function public.tick_session(p_session_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
  n integer := 0;
begin
  select * into s from public.game_sessions where id = p_session_id for update skip locked;
  if s.id is not null then
    n := private.advance_due(s.id);
    select * into s from public.game_sessions where id = p_session_id;
  else
    select * into s from public.game_sessions where id = p_session_id;
    if s.id is null then perform private.raise('session_not_found'); end if;
  end if;
  return jsonb_build_object('status', s.status, 'stateVersion', s.state_version, 'transitions', n);
end $$;

-- Backstop used by pg_cron (see the scheduling migration).
create or replace function private.tick_due_sessions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n integer := 0;
begin
  for v_id in
    select id from public.game_sessions
    where status in ('countdown', 'question_open', 'reveal', 'leaderboard')
      and (phase_ends_at <= clock_timestamp() or question_deadline <= clock_timestamp())
    for update skip locked
  loop
    n := n + private.advance_due(v_id);
  end loop;
  delete from private.rate_limits where window_start < now() - interval '1 hour';
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Answer submission (players)
-- ---------------------------------------------------------------------------
create or replace function public.submit_answer(
  p_session_id uuid, p_player_secret text, p_round_id uuid, p_choice_index integer, p_submission_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
  p public.participants;
  r public.session_rounds;
  q public.session_questions;
  a public.answers;
  v_now timestamptz;
  v_correct boolean;
  v_attempts integer;
  v_eligible integer;
  v_locked integer;
  v_count integer;
  v_base integer;
begin
  if p_choice_index is null or p_choice_index not between 0 and 3 then perform private.raise('invalid_choice'); end if;
  if p_submission_id is null then perform private.raise('invalid_request'); end if;

  -- Serialize with every other action on this session. This lock is what
  -- makes the buzzer race fair and the deadline check authoritative.
  select * into s from public.game_sessions where id = p_session_id for update;
  if s.id is null then perform private.raise('session_not_found'); end if;
  p := private.auth_participant(p_session_id, p_player_secret);
  perform private.rate_limit('submit:' || p.id, 40, 60);

  -- Idempotent retry of a submission that was already accepted.
  select * into a from public.answers where participant_id = p.id and submission_id = p_submission_id;
  if a.id is not null then
    return jsonb_build_object('result', 'duplicate', 'choiceIndex', a.choice_index, 'answerId', a.id);
  end if;

  -- Apply any transition that is already due (e.g. the deadline passed).
  perform private.advance_due(s.id);
  select * into s from public.game_sessions where id = p_session_id;

  -- Gameplay rejections are soft errors so that a transition applied above
  -- (closing an expired question) is kept.
  if s.status = 'paused' then return private.soft_error('game_paused'); end if;
  if s.status <> 'question_open' or s.current_round_id is distinct from p_round_id then
    return private.soft_error('question_closed');
  end if;
  select * into r from public.session_rounds where id = p_round_id;
  v_now := clock_timestamp();
  if r.status <> 'open' or (r.deadline is not null and v_now > r.deadline) then
    return private.soft_error('too_late');
  end if;
  select * into q from public.session_questions where id = r.question_id;
  v_correct := p_choice_index = q.correct_index;

  if s.mode = 'multiple_choice' then
    select * into a from public.answers where round_id = r.id and participant_id = p.id and attempt_no = 1;
    if a.id is not null then
      if not (s.settings ->> 'allowAnswerChange')::boolean then
        return private.soft_error('already_answered');
      end if;
      update public.answers set choice_index = p_choice_index, is_correct = v_correct,
        submission_id = p_submission_id, accepted_at = v_now, updated_at = v_now
      where id = a.id;
      return jsonb_build_object('result', 'changed', 'choiceIndex', p_choice_index, 'answerId', a.id);
    end if;
    insert into public.answers (session_id, round_id, participant_id, attempt_no, choice_index, is_correct, submission_id, accepted_at)
    values (s.id, r.id, p.id, 1, p_choice_index, v_correct, p_submission_id, v_now)
    returning * into a;
    select count(*) into v_count from public.answers where round_id = r.id;
    perform private.broadcast(s.id, 'answers', jsonb_build_object('roundId', r.id, 'count', v_count));
    -- Correctness is intentionally not returned until the question closes.
    return jsonb_build_object('result', 'accepted', 'choiceIndex', p_choice_index, 'answerId', a.id);
  end if;

  -- Color Buzzer
  select count(*) into v_attempts from public.answers where round_id = r.id and participant_id = p.id;
  if v_attempts > 0 and (s.settings ->> 'buzzerLockout')::boolean then
    return private.soft_error('locked_out');
  end if;
  if v_attempts >= 20 then return private.soft_error('locked_out'); end if;

  insert into public.answers (session_id, round_id, participant_id, attempt_no, choice_index, is_correct, submission_id, accepted_at)
  values (s.id, r.id, p.id, v_attempts + 1, p_choice_index, v_correct, p_submission_id, v_now)
  returning * into a;

  if v_correct then
    -- First correct answer to reach this point wins. The session lock
    -- guarantees nobody else can be here at the same time, and the
    -- winner column is only written while it is still empty.
    update public.session_rounds set winner_participant_id = p.id, winner_answer_id = a.id, winner_choice = p_choice_index
    where id = r.id and winner_participant_id is null;
    v_base := (s.settings ->> 'pointsCorrect')::integer;
    if v_base > 0 then
      insert into public.score_events (session_id, round_id, participant_id, answer_id, points, reason, base_points)
      values (s.id, r.id, p.id, a.id, v_base, 'buzzer_win', v_base)
      on conflict (round_id, participant_id) do nothing;
    end if;
    perform private.close_round(s.id, 'winner');
    perform private.audit('player', p.id, s.id, 'buzzer.win', jsonb_build_object(
      'roundId', r.id, 'answerId', a.id, 'choice', p_choice_index, 'acceptedAt', v_now));
    return jsonb_build_object('result', 'won', 'choiceIndex', p_choice_index, 'answerId', a.id, 'points', v_base);
  end if;

  -- Wrong answer: close the question if every eligible player is now locked out.
  if (s.settings ->> 'buzzerLockout')::boolean then
    select count(*) into v_eligible from public.participants where session_id = s.id and removed_at is null;
    select count(distinct participant_id) into v_locked from public.answers where round_id = r.id;
    if v_locked >= v_eligible then
      perform private.close_round(s.id, 'all_wrong');
    else
      perform private.broadcast(s.id, 'answers', jsonb_build_object('roundId', r.id, 'count', v_locked));
    end if;
  else
    perform private.broadcast(s.id, 'answers', jsonb_build_object('roundId', r.id));
  end if;
  return jsonb_build_object('result', 'wrong', 'choiceIndex', p_choice_index, 'answerId', a.id,
    'lockedOut', (s.settings ->> 'buzzerLockout')::boolean);
end $$;

-- ---------------------------------------------------------------------------
-- State snapshots
-- ---------------------------------------------------------------------------
create or replace function public.player_state(p_session_id uuid, p_player_secret text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
  p public.participants;
  v_q jsonb;
  v_round uuid;
  v_effective public.session_status;
  v_answers jsonb;
  v_me record;
  v_points integer;
  v_closed boolean;
begin
  select * into s from public.game_sessions where id = p_session_id;
  if s.id is null then perform private.raise('session_not_found'); end if;
  p := private.auth_participant(p_session_id, p_player_secret);
  if p.last_seen_at < now() - interval '10 seconds' then
    update public.participants set last_seen_at = now() where id = p.id;
  end if;

  v_effective := case when s.status = 'paused' then s.paused_from else s.status end;
  v_q := private.question_json(s.id, false, (s.settings ->> 'showChoicesOnPhone')::boolean);
  v_round := (v_q ->> 'roundId')::uuid;
  v_closed := coalesce(v_q ->> 'roundStatus', '') = 'closed';

  if v_round is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'choiceIndex', a.choice_index,
        'attemptNo', a.attempt_no,
        'acceptedAt', a.accepted_at,
        -- MC correctness stays hidden until the question closes. A buzzer
        -- press tells its own player straight away whether it was right.
        'isCorrect', case when v_closed or s.mode = 'color_buzzer' then a.is_correct else null end
      ) order by a.attempt_no), '[]'::jsonb)
    into v_answers from public.answers a where a.round_id = v_round and a.participant_id = p.id;
    select e.points into v_points from public.score_events e where e.round_id = v_round and e.participant_id = p.id;
  end if;

  select * into v_me from private.leaderboard(s.id) l where l.participant_id = p.id;

  return jsonb_build_object(
    'serverNow', clock_timestamp(),
    'session', private.session_core_json(s),
    'me', jsonb_build_object(
      'participantId', p.id, 'displayName', p.display_name,
      'score', coalesce(v_me.score, 0), 'rank', v_me.rank, 'correctCount', coalesce(v_me.correct_count, 0)
    ),
    'question', v_q,
    'myAnswers', coalesce(v_answers, '[]'::jsonb),
    'myRoundPoints', case when v_closed then coalesce(v_points, 0) else null end,
    'leaderboard', case when v_effective in ('leaderboard', 'finished') or s.status = 'finished'
      then private.leaderboard_json(s.id, 10) else null end,
    'results', case when s.status = 'finished' then jsonb_build_object('questionsPlayed', private.questions_played(s.id)) else null end
  );
end $$;

create or replace function public.projector_state(p_projector_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.game_sessions;
  v_effective public.session_status;
begin
  if p_projector_token is null or char_length(p_projector_token) < 22 then perform private.raise('session_not_found'); end if;
  select * into s from public.game_sessions where projector_token = p_projector_token;
  if s.id is null then perform private.raise('session_not_found'); end if;
  v_effective := case when s.status = 'paused' then s.paused_from else s.status end;
  return jsonb_build_object(
    'serverNow', clock_timestamp(),
    'session', private.session_core_json(s),
    'join', case when s.status not in ('finished', 'aborted')
      then jsonb_build_object('joinToken', s.join_token, 'roomCode', s.room_code,
        'open', private.joinable_reason(s) is null)
      else null end,
    'players', case when s.status = 'lobby' then (
        select coalesce(jsonb_agg(jsonb_build_object('participantId', p.id, 'displayName', p.display_name) order by p.joined_at), '[]'::jsonb)
        from (select * from public.participants where session_id = s.id and removed_at is null order by joined_at limit 300) p)
      else null end,
    'question', private.question_json(s.id, true, true),
    'leaderboard', case when v_effective in ('reveal', 'leaderboard') then private.leaderboard_json(s.id, 10) else null end,
    'results', case when s.status = 'finished' then s.final_results else null end
  );
end $$;

create or replace function public.host_state(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  s public.game_sessions;
  v_q jsonb;
begin
  select * into s from public.game_sessions where id = p_session_id;
  if s.id is null or (s.host_id <> v_uid and not private.is_admin(v_uid)) then perform private.raise('not_found'); end if;
  v_q := private.question_json(s.id, true, true);
  return jsonb_build_object(
    'serverNow', clock_timestamp(),
    'session', private.session_core_json(s) || jsonb_build_object('settings', s.settings),
    'join', jsonb_build_object('joinToken', s.join_token, 'roomCode', s.room_code, 'projectorToken', s.projector_token,
      'open', private.joinable_reason(s) is null),
    'question', v_q || coalesce((
      select jsonb_build_object('correctIndex', q.correct_index)
      from public.session_questions q where q.session_id = s.id and q.position = s.current_position), '{}'::jsonb),
    'nextQuestion', (
      select jsonb_build_object('position', q.position, 'prompt', q.prompt)
      from public.session_questions q where q.session_id = s.id and q.position = coalesce(s.current_position, -1) + 1),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'participantId', p.id, 'displayName', p.display_name, 'joinedAt', p.joined_at, 'lastSeenAt', p.last_seen_at
        ) order by p.joined_at), '[]'::jsonb)
      from public.participants p where p.session_id = s.id and p.removed_at is null),
    'attempts', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'participantId', a.participant_id, 'displayName', p.display_name, 'choiceIndex', a.choice_index,
          'isCorrect', a.is_correct, 'acceptedAt', a.accepted_at, 'attemptNo', a.attempt_no
        ) order by a.accepted_at), '[]'::jsonb)
      from public.answers a join public.participants p on p.id = a.participant_id
      where a.round_id = (v_q ->> 'roundId')::uuid),
    'leaderboard', private.leaderboard_json(s.id, null),
    'results', s.final_results
  );
end $$;

-- ---------------------------------------------------------------------------
-- Host controls
-- ---------------------------------------------------------------------------
create or replace function public.host_command(
  p_session_id uuid, p_command text, p_expected_version integer default null, p_args jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  s public.game_sessions;
  v_now timestamptz := clock_timestamp();
  v_remaining integer;
  v_count integer;
  v_target uuid;
begin
  select * into s from public.game_sessions where id = p_session_id for update;
  if s.id is null or (s.host_id <> v_uid and not private.is_admin(v_uid)) then perform private.raise('not_found'); end if;
  perform private.rate_limit('host_cmd:' || s.id, 120, 60);

  -- Idempotency: a repeated or stale command (double click, a second host
  -- device) is ignored rather than applied twice.
  if p_expected_version is not null and p_expected_version <> s.state_version then
    return jsonb_build_object('applied', false, 'reason', 'stale_version', 'stateVersion', s.state_version, 'status', s.status);
  end if;

  if p_command <> 'end' then
    perform private.advance_due(s.id);
    select * into s from public.game_sessions where id = p_session_id;
  end if;

  if s.status in ('finished', 'aborted') then perform private.raise('session_ended'); end if;

  case p_command
  when 'start' then
    if s.status <> 'lobby' then perform private.raise('invalid_transition', s.status::text); end if;
    select count(*) into v_count from public.participants where session_id = s.id and removed_at is null;
    if v_count = 0 then perform private.raise('no_players'); end if;
    update public.game_sessions set started_at = v_now where id = s.id;
    perform private.begin_countdown(s.id, 0);

  when 'pause' then
    if s.status not in ('countdown', 'question_open', 'reveal', 'leaderboard') then
      perform private.raise('invalid_transition', s.status::text);
    end if;
    if s.status = 'question_open' then
      v_remaining := case when s.question_deadline is null then null
        else greatest(0, (extract(epoch from (s.question_deadline - v_now)) * 1000)::integer) end;
    else
      v_remaining := case when s.phase_ends_at is null then null
        else greatest(0, (extract(epoch from (s.phase_ends_at - v_now)) * 1000)::integer) end;
    end if;
    update public.game_sessions set status = 'paused', paused_from = s.status, paused_remaining_ms = v_remaining,
      paused_at = v_now
    where id = s.id;
    perform private.bump(s.id);

  when 'resume' then
    if s.status <> 'paused' then perform private.raise('invalid_transition', s.status::text); end if;
    -- Timing policy: the phase resumes with the time that was left when it
    -- was paused (at least 3 seconds for an open question).
    if s.paused_from = 'question_open' then
      update public.game_sessions set status = 'question_open',
        question_deadline = case when s.paused_remaining_ms is null then null
          else v_now + make_interval(secs => greatest(s.paused_remaining_ms, 3000) / 1000.0) end
      where id = s.id;
      update public.session_rounds set deadline = (select question_deadline from public.game_sessions where id = s.id)
      where id = s.current_round_id;
    else
      update public.game_sessions set status = s.paused_from,
        phase_ends_at = case when s.paused_remaining_ms is null then null
          else v_now + make_interval(secs => greatest(s.paused_remaining_ms, 1000) / 1000.0) end
      where id = s.id;
    end if;
    update public.game_sessions set paused_from = null, paused_remaining_ms = null, paused_at = null where id = s.id;
    perform private.bump(s.id);

  when 'next' then
    if s.status = 'lobby' then
      return public.host_command(p_session_id, 'start', null, p_args);
    end if;
    if s.status = 'paused' then perform private.raise('game_paused'); end if;
    perform private.step(s.id, true);

  when 'close_question' then
    if s.status <> 'question_open' then perform private.raise('invalid_transition', s.status::text); end if;
    perform private.close_round(s.id, 'host_closed');

  when 'skip' then
    if s.status = 'paused' then perform private.raise('game_paused'); end if;
    if s.status = 'question_open' then
      update public.session_rounds set status = 'voided', closed_at = v_now, close_reason = 'skipped'
      where id = s.current_round_id;
      perform private.go_next(s.id);
    elsif s.status in ('countdown', 'reveal', 'leaderboard') then
      perform private.go_next(s.id);
    else
      perform private.raise('invalid_transition', s.status::text);
    end if;

  when 'replay' then
    if not (s.settings ->> 'allowReplay')::boolean then perform private.raise('replay_disabled'); end if;
    if s.status not in ('question_open', 'reveal', 'leaderboard') then
      perform private.raise('invalid_transition', s.status::text);
    end if;
    -- Void the latest round for this question; its points no longer count.
    update public.session_rounds set status = 'voided', closed_at = coalesce(closed_at, v_now), close_reason = 'replayed'
    where id = (select id from public.session_rounds where session_id = s.id and position = s.current_position
                order by attempt desc limit 1);
    perform private.begin_countdown(s.id, s.current_position);

  when 'end' then
    perform private.finish(s.id, case when s.status = 'lobby' then 'aborted'::public.session_status else 'finished'::public.session_status end);

  when 'remove_player' then
    v_target := (p_args ->> 'participantId')::uuid;
    update public.participants set removed_at = v_now where id = v_target and session_id = s.id and removed_at is null;
    if not found then perform private.raise('not_found'); end if;
    perform private.broadcast(s.id, 'roster', '{}'::jsonb);

  else
    perform private.raise('invalid_command');
  end case;

  perform private.audit('host', v_uid, s.id, 'session.' || p_command,
    jsonb_build_object('from', s.status, 'args', coalesce(p_args, '{}'::jsonb)));
  select * into s from public.game_sessions where id = p_session_id;
  return jsonb_build_object('applied', true, 'stateVersion', s.state_version, 'status', s.status);
end $$;

-- Delete a completed session (guest names and answers go with it).
create or replace function public.delete_session(p_session_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
begin
  delete from public.game_sessions where id = p_session_id and host_id = v_uid and status in ('finished', 'aborted');
  if not found then perform private.raise('not_found'); end if;
  perform private.audit('host', v_uid, p_session_id, 'session.deleted');
end $$;

-- Per-question breakdown for the results page.
create or replace function public.session_results(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  s public.game_sessions;
begin
  select * into s from public.game_sessions where id = p_session_id;
  if s.id is null or (s.host_id <> v_uid and not private.is_admin(v_uid)) then perform private.raise('not_found'); end if;
  return jsonb_build_object(
    'session', private.session_core_json(s) || jsonb_build_object('createdAt', s.created_at, 'quizId', s.quiz_id),
    'standings', coalesce(s.final_results -> 'standings', private.leaderboard_json(s.id, null)),
    'questionsPlayed', private.questions_played(s.id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', q.position, 'prompt', q.prompt, 'choices', to_jsonb(q.choices), 'correctIndex', q.correct_index,
        'played', r.id is not null,
        'answerCount', (select count(distinct a.participant_id) from public.answers a where a.round_id = r.id),
        'correctCount', (select count(distinct a.participant_id) from public.answers a where a.round_id = r.id and a.is_correct),
        'winner', (select p.display_name from public.participants p where p.id = r.winner_participant_id),
        'closeReason', r.close_reason
      ) order by q.position), '[]'::jsonb)
      from public.session_questions q
      left join lateral (
        select * from public.session_rounds r0
        where r0.session_id = s.id and r0.position = q.position and r0.status = 'closed'
        order by r0.attempt desc limit 1
      ) r on true
      where q.session_id = s.id)
  );
end $$;
