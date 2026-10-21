-- Projector music and sound effects.
--  * New session setting soundOn (default true), shown to clients.
--  * host_set_sound lets the host mute or unmute the projector during a game.

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
    'maxPlayers',           private.json_int(p -> 'maxPlayers', 100, 2, 500),
    'soundOn',              private.json_bool(p -> 'soundOn', true)
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
      'pointsCorrect', s.settings -> 'pointsCorrect',
      'soundOn', coalesce(s.settings -> 'soundOn', 'true'::jsonb)
    )
  );
$$;

create or replace function public.host_set_sound(p_session_id uuid, p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  s public.game_sessions;
begin
  if p_on is null then perform private.raise('invalid_request'); end if;
  select * into s from public.game_sessions where id = p_session_id for update;
  if s.id is null or (s.host_id <> v_uid and not private.is_admin(v_uid)) then perform private.raise('not_found'); end if;
  perform private.rate_limit('host_cmd:' || s.id, 120, 60);
  if coalesce((s.settings ->> 'soundOn')::boolean, true) is distinct from p_on then
    update public.game_sessions set settings = settings || jsonb_build_object('soundOn', p_on) where id = s.id;
    perform private.bump(s.id);
  end if;
  return jsonb_build_object('soundOn', p_on, 'stateVersion', (select state_version from public.game_sessions where id = s.id));
end $$;

revoke all on function public.host_set_sound(uuid, boolean) from public, anon;
grant execute on function public.host_set_sound(uuid, boolean) to authenticated;
