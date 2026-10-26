-- Photo limits and automatic clean-up.
--
--  * Free accounts can keep 10 photos; accounts with hosting access 200.
--  * A photo is detached from its question 30 days after the last game that
--    used it, or 90 days after the quiz was last edited if it was never played.
--  * Draft quizzes nobody has touched for 60 days are deleted.
--
-- Deleting a row in storage.objects does not remove the file itself, so every
-- photo that is detached or whose quiz is deleted is queued in
-- private.photo_trash. `pnpm purge:photos` (scripts/purge-photos.mjs) deletes
-- the queued files through the Storage API.

create table if not exists private.photo_trash (
  path text primary key,
  queued_at timestamptz not null default now()
);
revoke all on private.photo_trash from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------
create or replace function private.photo_limit(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when private.is_admin(p_uid)
      or exists (select 1 from public.entitlements
                 where user_id = p_uid and status = 'active' and starts_at <= now() and expires_at > now())
    then 200 else 10 end;
$$;

create or replace function private.photos_used(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from storage.objects o
  where o.bucket_id = 'question-images'
    and (storage.foldername(o.name))[1] = p_uid::text
    and not exists (select 1 from private.photo_trash t where t.path = o.name);
$$;

create or replace function public.my_photo_quota() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  return jsonb_build_object('used', private.photos_used(v_uid), 'limit', private.photo_limit(v_uid));
end $$;
revoke all on function public.my_photo_quota() from public, anon;
grant execute on function public.my_photo_quota() to authenticated;

-- Storage policies run as the signed-in user, who cannot reach the private
-- schema, so the check is a small public function that only ever looks at the
-- caller's own account.
create or replace function public.can_add_photo() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.photos_used((select auth.uid())) < private.photo_limit((select auth.uid()));
$$;
revoke all on function public.can_add_photo() from public, anon;
grant execute on function public.can_add_photo() to authenticated;

drop policy if exists question_images_insert_own on storage.objects;
create policy question_images_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.can_add_photo()
  );

-- ---------------------------------------------------------------------------
-- Clean-up
-- ---------------------------------------------------------------------------
create or replace function private.purge_content(
  p_played_days integer default 30,
  p_unplayed_days integer default 90,
  p_draft_days integer default 60
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old_drafts uuid[];
  v_old_photos uuid[];
  v_drafts integer;
  v_photos integer;
begin
  -- 1. Draft quizzes untouched for p_draft_days (quiz or any of its questions).
  select coalesce(array_agg(q.id), '{}') into v_old_drafts from public.quizzes q
  where q.status = 'draft'
    and greatest(q.updated_at, coalesce((select max(x.updated_at) from public.questions x where x.quiz_id = q.id), q.updated_at))
        < now() - make_interval(days => p_draft_days);

  insert into private.photo_trash (path)
  select distinct x.media ->> 'path' from public.questions x
  where x.quiz_id = any (v_old_drafts) and x.media ->> 'path' is not null
  on conflict do nothing;

  delete from public.quizzes where id = any (v_old_drafts);
  get diagnostics v_drafts = row_count;

  -- 2. Photos on quizzes that were played long ago, or never played and left alone.
  select coalesce(array_agg(x.id), '{}') into v_old_photos
  from public.questions x
  join public.quizzes q on q.id = x.quiz_id
  where x.media is not null
    and case
      when exists (select 1 from public.game_sessions s where s.quiz_id = q.id)
        then (select max(coalesce(s.ended_at, s.updated_at)) from public.game_sessions s where s.quiz_id = q.id)
             < now() - make_interval(days => p_played_days)
      else greatest(q.updated_at, x.updated_at) < now() - make_interval(days => p_unplayed_days)
    end;

  insert into private.photo_trash (path)
  select distinct x.media ->> 'path' from public.questions x
  where x.id = any (v_old_photos) and x.media ->> 'path' is not null
  on conflict do nothing;

  update public.questions set media = null where id = any (v_old_photos);
  get diagnostics v_photos = row_count;

  if v_drafts + v_photos > 0 then
    perform private.audit('system', null, null, 'retention.content',
      jsonb_build_object('deletedDrafts', v_drafts, 'detachedPhotos', v_photos));
  end if;
  return jsonb_build_object('deletedDrafts', v_drafts, 'detachedPhotos', v_photos);
end $$;
revoke all on function private.purge_content(integer, integer, integer) from public, anon, authenticated;

-- Files for photos whose question was deleted by the host (or by account
-- deletion) are removed by the app itself; anything left behind is queued here.
create or replace function private.queue_orphan_photos() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into private.photo_trash (path)
  select o.name from storage.objects o
  where o.bucket_id = 'question-images'
    and o.created_at < now() - interval '1 day'
    and not exists (select 1 from public.questions x where x.media ->> 'path' = o.name)
    and not exists (select 1 from public.session_questions sq where sq.media ->> 'path' = o.name)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.queue_orphan_photos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('buzzavid_content_retention') where exists (select 1 from cron.job where jobname = 'buzzavid_content_retention');
      perform cron.schedule('buzzavid_content_retention', '45 3 * * *',
        'select private.purge_content(); select private.queue_orphan_photos()');
    exception when others then
      raise notice 'buzzavid_content_retention not scheduled: %', sqlerrm;
    end;
  end if;
end $$;

-- For scripts/purge-photos.mjs, which runs with the service-role key only.
create or replace function public.photo_trash_batch(p_limit integer default 200) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(path), '{}') from (select path from private.photo_trash order by queued_at limit least(p_limit, 1000)) t;
$$;
create or replace function public.photo_trash_done(p_paths text[]) returns void
language sql volatile security definer set search_path = '' as $$
  delete from private.photo_trash where path = any (p_paths);
$$;
revoke all on function public.photo_trash_batch(integer), public.photo_trash_done(text[]) from public, anon, authenticated;
grant execute on function public.photo_trash_batch(integer), public.photo_trash_done(text[]) to service_role;
