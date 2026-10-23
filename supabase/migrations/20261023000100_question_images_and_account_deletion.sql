-- Photo questions and in-app account deletion.
--
-- 1. Hosts can attach one photo to a question. The photo lives in a public
--    Storage bucket under an unguessable path; the question row stores only
--    the path in `questions.media` as {"type":"image","path":"<uid>/<uuid>.jpg"}.
-- 2. The photo is copied into the session snapshot when a game is launched, and
--    shown on the projector and host screens (never needed on player phones).
-- 3. Apple requires apps that create accounts to let people delete them from
--    inside the app. `delete_my_account()` does that.

-- ---------------------------------------------------------------------------
-- Question media
-- ---------------------------------------------------------------------------
alter table public.questions
  drop constraint if exists questions_media_shape;
alter table public.questions
  add constraint questions_media_shape check (
    media is null
    or (
      jsonb_typeof(media) = 'object'
      and media ->> 'type' = 'image'
      and char_length(media ->> 'path') between 10 and 200
      and media ->> 'path' ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    )
  );

alter table public.session_questions add column if not exists media jsonb;

-- Copy the photo into the session snapshot at launch, whichever code path
-- inserted the row.
create or replace function private.session_question_media() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.media is null and new.source_question_id is not null then
    select q.media into new.media from public.questions q where q.id = new.source_question_id;
  end if;
  return new;
end $$;

drop trigger if exists session_questions_media on public.session_questions;
create trigger session_questions_media before insert on public.session_questions
  for each row execute function private.session_question_media();

-- Public URL path of the photo is only included for the projector and host views.
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
    'imagePath', case when p_include_prompt then q.media ->> 'path' else null end,
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

-- ---------------------------------------------------------------------------
-- Storage bucket for question photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read (the path is a random UUID and only appears on screens that
-- should show it). Only a host can add, replace or remove files in their own
-- folder, named after their user id.
drop policy if exists question_images_insert_own on storage.objects;
create policy question_images_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists question_images_update_own on storage.objects;
create policy question_images_update_own on storage.objects for update to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists question_images_delete_own on storage.objects;
create policy question_images_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
-- Deleting the auth user cascades to the host's profile, quizzes, questions,
-- games (with guest names, answers and scores), entitlements and redemptions.
-- Audit entries keep only the random user id (no email or name) until the
-- nightly retention job removes them after 365 days. The app deletes the
-- host's photos through the Storage API first.
create or replace function public.delete_my_account() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  perform private.audit('host', v_uid, null, 'account.deleted', '{}'::jsonb);
  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
