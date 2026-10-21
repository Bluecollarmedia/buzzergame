-- CrowdQuiz game engine: authoritative session state machine, scoring and
-- state snapshots. Every function here assumes the caller already holds a
-- row lock on the game_sessions row (select ... for update), so transitions
-- for one session are strictly serialized.
--
-- Status flow (see docs/game-engine.md):
--   lobby -> countdown -> question_open -> reveal -> [leaderboard] -> countdown ... -> finished
--   any active status <-> paused;  lobby -> aborted;  any -> finished (host ends)

-- ---------------------------------------------------------------------------
-- Leaderboard and results
-- ---------------------------------------------------------------------------
create or replace function private.leaderboard(p_sid uuid)
returns table (
  participant_id uuid, display_name text, score integer, correct_count integer,
  answered_count integer, rank integer
)
language sql stable security definer set search_path = '' as $$
  with valid_rounds as (
    select r.id from public.session_rounds r where r.session_id = p_sid and r.status = 'closed'
  ), pts as (
    select e.participant_id, sum(e.points)::integer as score
    from public.score_events e join valid_rounds v on v.id = e.round_id
    group by e.participant_id
  ), ans as (
    select a.participant_id,
      (count(distinct a.round_id) filter (where a.is_correct))::integer as correct_count,
      count(distinct a.round_id)::integer as answered_count
    from public.answers a join valid_rounds v on v.id = a.round_id
    group by a.participant_id
  )
  select p.id, p.display_name,
    coalesce(pts.score, 0), coalesce(ans.correct_count, 0), coalesce(ans.answered_count, 0),
    (rank() over (order by coalesce(pts.score, 0) desc))::integer
  from public.participants p
  left join pts on pts.participant_id = p.id
  left join ans on ans.participant_id = p.id
  where p.session_id = p_sid and p.removed_at is null
  order by 6, p.joined_at;
$$;

create or replace function private.questions_played(p_sid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.session_rounds r where r.session_id = p_sid and r.status = 'closed';
$$;

create or replace function private.leaderboard_json(p_sid uuid, p_limit integer default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'participantId', l.participant_id,
      'displayName', l.display_name,
      'score', l.score,
      'correctCount', l.correct_count,
      'answeredCount', l.answered_count,
      'rank', l.rank
    ) order by l.rank, l.display_name), '[]'::jsonb)
  from (select * from private.leaderboard(p_sid) limit p_limit) l;
$$;

create or replace function private.results_json(p_sid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'questionsPlayed', private.questions_played(p_sid),
    'standings', private.leaderboard_json(p_sid, null)
  );
$$;

-- ---------------------------------------------------------------------------
-- State transitions (caller holds the session row lock)
-- ---------------------------------------------------------------------------
create or replace function private.bump(p_sid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.game_sessions set state_version = state_version + 1 where id = p_sid;
  perform private.broadcast(p_sid, 'state', jsonb_build_object(
    'v', (select state_version from public.game_sessions where id = p_sid)
  ));
end $$;

create or replace function private.open_question(p_sid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
  q public.session_questions;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_attempt integer;
  v_round uuid;
begin
  select * into s from public.game_sessions where id = p_sid;
  select * into q from public.session_questions where session_id = p_sid and position = s.current_position;
  if q.id is null then perform private.raise('internal', 'question snapshot missing'); end if;

  if s.mode = 'multiple_choice' then
    v_deadline := v_now + make_interval(secs => coalesce(q.time_limit_seconds, (s.settings ->> 'timeLimitSeconds')::integer));
  elsif s.settings ->> 'buzzerTimeLimitSeconds' is not null then
    v_deadline := v_now + make_interval(secs => (s.settings ->> 'buzzerTimeLimitSeconds')::integer);
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt
  from public.session_rounds where session_id = p_sid and position = s.current_position;

  insert into public.session_rounds (session_id, question_id, position, attempt, opened_at, deadline)
  values (p_sid, q.id, s.current_position, v_attempt, v_now, v_deadline)
  returning id into v_round;

  update public.game_sessions set
    status = 'question_open', current_round_id = v_round,
    question_started_at = v_now, question_deadline = v_deadline, phase_ends_at = null
  where id = p_sid;
  perform private.bump(p_sid);
end $$;

create or replace function private.begin_countdown(p_sid uuid, p_position integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
  v_secs integer;
begin
  select * into s from public.game_sessions where id = p_sid;
  v_secs := (s.settings ->> 'countdownSeconds')::integer;
  update public.game_sessions set
    status = 'countdown', current_position = p_position, current_round_id = null,
    question_started_at = null, question_deadline = null,
    phase_ends_at = clock_timestamp() + make_interval(secs => v_secs)
  where id = p_sid;
  if v_secs = 0 then
    perform private.open_question(p_sid);
  else
    perform private.bump(p_sid);
  end if;
end $$;

create or replace function private.finish(p_sid uuid, p_status public.session_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.session_rounds
    set status = 'voided', closed_at = clock_timestamp(), close_reason = 'ended'
    where session_id = p_sid and status = 'open';
  update public.game_sessions set
    status = p_status, ended_at = clock_timestamp(), phase_ends_at = null,
    question_deadline = null, paused_from = null, paused_remaining_ms = null, paused_at = null
  where id = p_sid;
  update public.game_sessions set final_results = private.results_json(p_sid) where id = p_sid;
  perform private.bump(p_sid);
end $$;

-- Close the open round, award Multiple Choice points and show the reveal.
create or replace function private.close_round(p_sid uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
  r public.session_rounds;
  q public.session_questions;
  v_now timestamptz := clock_timestamp();
begin
  select * into s from public.game_sessions where id = p_sid;
  select * into r from public.session_rounds where id = s.current_round_id;
  if r.id is null or r.status <> 'open' then
    perform private.raise('internal', 'no open round to close');
  end if;
  select * into q from public.session_questions where id = r.question_id;

  update public.session_rounds set status = 'closed', closed_at = v_now, close_reason = p_reason
  where id = r.id;

  if s.mode = 'multiple_choice' then
    insert into public.score_events (session_id, round_id, participant_id, answer_id, points, reason, base_points, bonus_points)
    select p_sid, r.id, a.participant_id, a.id, pts.base_points + pts.bonus_points, 'correct', pts.base_points, pts.bonus_points
    from public.answers a
    cross join lateral private.mc_points(s.settings, true, a.accepted_at, r.opened_at, r.deadline) pts
    where a.round_id = r.id and a.choice_index = q.correct_index
      and (pts.base_points + pts.bonus_points) > 0
    on conflict (round_id, participant_id) do nothing;
  end if;

  update public.game_sessions set
    status = 'reveal',
    phase_ends_at = case when (s.settings ->> 'autoAdvance')::boolean
      then v_now + make_interval(secs => (s.settings ->> 'revealSeconds')::integer) else null end
  where id = p_sid;
  perform private.bump(p_sid);
end $$;

create or replace function private.go_next(p_sid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
begin
  select * into s from public.game_sessions where id = p_sid;
  if coalesce(s.current_position, -1) + 1 < s.question_count then
    perform private.begin_countdown(p_sid, coalesce(s.current_position, -1) + 1);
  else
    perform private.finish(p_sid, 'finished');
  end if;
end $$;

-- Perform one transition if it is due (or forced by the host).
-- Returns true when the state changed.
create or replace function private.step(p_sid uuid, p_force boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions;
  v_now timestamptz := clock_timestamp();
  v_last boolean;
begin
  select * into s from public.game_sessions where id = p_sid;
  if s.status = 'countdown' then
    if p_force or s.phase_ends_at <= v_now then
      perform private.open_question(p_sid);
      return true;
    end if;
  elsif s.status = 'question_open' then
    if p_force then
      perform private.close_round(p_sid, 'host_closed');
      return true;
    elsif s.question_deadline is not null and s.question_deadline <= v_now then
      perform private.close_round(p_sid, 'deadline');
      return true;
    end if;
  elsif s.status = 'reveal' then
    if p_force or (s.phase_ends_at is not null and s.phase_ends_at <= v_now) then
      v_last := s.current_position + 1 >= s.question_count;
      if (s.settings ->> 'showLeaderboard')::boolean and not v_last then
        update public.game_sessions set
          status = 'leaderboard',
          phase_ends_at = case when (s.settings ->> 'autoAdvance')::boolean
            then v_now + make_interval(secs => (s.settings ->> 'leaderboardSeconds')::integer) else null end
        where id = p_sid;
        perform private.bump(p_sid);
      else
        perform private.go_next(p_sid);
      end if;
      return true;
    end if;
  elsif s.status = 'leaderboard' then
    if p_force or (s.phase_ends_at is not null and s.phase_ends_at <= v_now) then
      perform private.go_next(p_sid);
      return true;
    end if;
  end if;
  return false;
end $$;

-- Run every transition that is due according to the server clock.
-- Several phases may have elapsed if nobody was connected.
create or replace function private.advance_due(p_sid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
begin
  while n < 20 and private.step(p_sid, false) loop
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Participant authentication
-- ---------------------------------------------------------------------------
create or replace function private.auth_participant(p_sid uuid, p_secret text)
returns public.participants
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.participants;
begin
  if not private.valid_secret(p_secret) then perform private.raise('invalid_player'); end if;
  select * into p from public.participants
  where session_id = p_sid and secret_hash = private.sha256_hex(p_secret);
  if p.id is null then perform private.raise('invalid_player'); end if;
  if p.removed_at is not null then perform private.raise('player_removed'); end if;
  return p;
end $$;

-- ---------------------------------------------------------------------------
-- State snapshots
-- ---------------------------------------------------------------------------

-- Public question payload. The correct answer is included only once the
-- round is closed.
create or replace function private.question_json(p_sid uuid, p_include_prompt boolean, p_include_choices boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.game_sessions;
  r public.session_rounds;
  q public.session_questions;
  v_effective public.session_status;
  v_closed boolean;
  v_dist jsonb;
  v_winner jsonb;
begin
  select * into s from public.game_sessions where id = p_sid;
  if s.current_position is null then return null; end if;
  v_effective := case when s.status = 'paused' then s.paused_from else s.status end;
  if v_effective not in ('question_open', 'reveal', 'leaderboard') then
    return jsonb_build_object('position', s.current_position);
  end if;
  select * into r from public.session_rounds where id = s.current_round_id;
  if r.id is null then
    -- The round of the last question shown (e.g. during leaderboard).
    select * into r from public.session_rounds
    where session_id = p_sid and position = s.current_position
    order by attempt desc limit 1;
  end if;
  select * into q from public.session_questions where session_id = p_sid and position = s.current_position;
  v_closed := r.id is not null and r.status = 'closed';

  if v_closed then
    select jsonb_build_array(
      count(*) filter (where choice_index = 0), count(*) filter (where choice_index = 1),
      count(*) filter (where choice_index = 2), count(*) filter (where choice_index = 3))
    into v_dist from public.answers where round_id = r.id;
    if r.winner_participant_id is not null then
      select jsonb_build_object('participantId', p.id, 'displayName', p.display_name, 'choiceIndex', r.winner_choice)
      into v_winner from public.participants p where p.id = r.winner_participant_id;
    end if;
  end if;

  return jsonb_build_object(
    'position', s.current_position,
    'roundId', r.id,
    'attempt', r.attempt,
    'prompt', case when p_include_prompt then q.prompt else null end,
    'choices', case when p_include_choices then to_jsonb(q.choices) else null end,
    'startedAt', r.opened_at,
    'deadline', r.deadline,
    'roundStatus', r.status,
    'closeReason', r.close_reason,
    'correctIndex', case when v_closed then q.correct_index else null end,
    'distribution', v_dist,
    'winner', v_winner,
    'answerCount', (select count(distinct participant_id) from public.answers where round_id = r.id)
  );
end $$;

create or replace function private.session_core_json(s public.game_sessions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.quiz_title,
    'mode', s.mode,
    'status', s.status,
    'pausedFrom', s.paused_from,
    'pausedRemainingMs', s.paused_remaining_ms,
    'questionCount', s.question_count,
    'currentPosition', s.current_position,
    'phaseEndsAt', s.phase_ends_at,
    'stateVersion', s.state_version,
    'startedAt', s.started_at,
    'endedAt', s.ended_at,
    'playerCount', (select count(*) from public.participants p where p.session_id = s.id and p.removed_at is null),
    'settings', jsonb_build_object(
      'timeLimitSeconds', s.settings -> 'timeLimitSeconds',
      'autoAdvance', s.settings -> 'autoAdvance',
      'showLeaderboard', s.settings -> 'showLeaderboard',
      'allowAnswerChange', s.settings -> 'allowAnswerChange',
      'buzzerLockout', s.settings -> 'buzzerLockout',
      'showChoicesOnPhone', s.settings -> 'showChoicesOnPhone',
      'allowLateJoin', s.settings -> 'allowLateJoin',
      'pointsCorrect', s.settings -> 'pointsCorrect'
    )
  );
$$;
