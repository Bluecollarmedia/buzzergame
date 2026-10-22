-- Players found the leaderboard between questions slow and distracting.
-- It is now off by default: reveal goes straight to the next question and
-- standings appear only at the end. Hosts can still turn it on at launch.

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
    'showLeaderboard',      private.json_bool(p -> 'showLeaderboard', false),
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
