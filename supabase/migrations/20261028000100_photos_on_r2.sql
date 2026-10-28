-- Question photos move from Supabase Storage to Cloudflare R2.
--
-- The website's /api/photos route now stores the files in R2. The database
-- keeps a list of every photo (private.photo_files) so it can still enforce
-- the 10 / 200 limit, the Photo uploads switch, the clean-up and account
-- deletion. Paths keep the same shape: <host id>/<random id>.jpg.
--
-- Photos already in Supabase Storage are listed here once, then copied to R2
-- from the Admin tab ("Copy photos to Cloudflare"). New uploads straight to
-- Supabase Storage are no longer allowed.

create table if not exists private.photo_files (
  path text primary key check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  owner_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists photo_files_owner_idx on private.photo_files (owner_id);
revoke all on private.photo_files from public, anon, authenticated;

-- Every photo uploaded to Supabase Storage so far.
insert into private.photo_files (path, owner_id, created_at)
select o.name, ((storage.foldername(o.name))[1])::uuid, coalesce(o.created_at, now())
from storage.objects o
where o.bucket_id = 'question-images'
  and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  and not exists (select 1 from private.photo_trash t where t.path = o.name)
on conflict (path) do nothing;

-- Old app versions uploaded straight to the bucket. That is now closed; the
-- website's upload route is the only way in. Reading old files still works.
drop policy if exists question_images_insert_own on storage.objects;
drop policy if exists question_images_update_own on storage.objects;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------
create or replace function private.photos_used(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from private.photo_files f
  where f.owner_id = p_uid
    and not exists (select 1 from private.photo_trash t where t.path = f.path);
$$;

-- Called by the website (with the host's own sign-in) just before it stores a
-- new photo. Checks the switch and the limit, then hands out a fresh path.
create or replace function public.reserve_question_photo(p_ext text default 'jpg') returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  v_path text;
begin
  if p_ext not in ('jpg', 'png', 'webp') then perform private.raise('invalid_request'); end if;
  if not private.photo_uploads_enabled() then perform private.raise('photo_uploads_off'); end if;
  perform private.rate_limit('photo:' || v_uid::text, 60, 3600);
  if private.photos_used(v_uid) >= private.photo_limit(v_uid) then perform private.raise('photo_limit'); end if;
  v_path := v_uid::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.photo_files (path, owner_id) values (v_path, v_uid);
  return v_path;
end $$;
revoke all on function public.reserve_question_photo(text) from public, anon;
grant execute on function public.reserve_question_photo(text) to authenticated;

-- Forgets one of the caller's photos so the website can delete the file.
-- Returns false if the path is not one of theirs.
create or replace function public.release_question_photo(p_path text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  n integer;
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  delete from private.photo_files where path = p_path and owner_id = v_uid;
  get diagnostics n = row_count;
  delete from private.photo_trash where path = p_path and n > 0;
  return n > 0;
end $$;
revoke all on function public.release_question_photo(text) from public, anon;
grant execute on function public.release_question_photo(text) to authenticated;

-- Forgets all of the caller's photos (just before account deletion) and
-- returns their paths so the website can delete the files.
create or replace function public.release_all_my_photos() returns text[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_paths text[];
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  with gone as (delete from private.photo_files where owner_id = v_uid returning path)
  select coalesce(array_agg(path), '{}') into v_paths from gone;
  delete from private.photo_trash where path = any (v_paths);
  return v_paths;
end $$;
revoke all on function public.release_all_my_photos() from public, anon;
grant execute on function public.release_all_my_photos() to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion: anything the website did not already remove is queued.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  insert into private.photo_trash (path)
  select path from private.photo_files where owner_id = v_uid
  on conflict do nothing;
  perform private.audit('host', v_uid, null, 'account.deleted', '{}'::jsonb);
  delete from auth.users where id = v_uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Clean-up: photos no question or game uses any more are queued.
-- ---------------------------------------------------------------------------
create or replace function private.queue_orphan_photos() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into private.photo_trash (path)
  select f.path from private.photo_files f
  where f.created_at < now() - interval '1 day'
    and not exists (select 1 from public.questions x where x.media ->> 'path' = f.path)
    and not exists (select 1 from public.session_questions sq where sq.media ->> 'path' = f.path)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.queue_orphan_photos() from public, anon, authenticated;

-- Once a queued file is deleted, it is forgotten entirely.
create or replace function public.photo_trash_done(p_paths text[]) returns void
language sql volatile security definer set search_path = '' as $$
  delete from private.photo_files where path = any (p_paths);
  delete from private.photo_trash where path = any (p_paths);
$$;
revoke all on function public.photo_trash_done(text[]) from public, anon, authenticated;
grant execute on function public.photo_trash_done(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Admin: the Admin tab runs the copy and the clean-up through the website.
-- ---------------------------------------------------------------------------
-- Photos still to check for copying, in path order after p_after.
create or replace function public.admin_photo_files(p_after text default '', p_limit integer default 25) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v text[];
begin
  perform private.require_admin();
  select coalesce(array_agg(path order by path), '{}') into v from (
    select f.path from private.photo_files f
    where f.path > coalesce(p_after, '')
    order by f.path
    limit least(greatest(p_limit, 1), 100)
  ) t;
  return v;
end $$;
revoke all on function public.admin_photo_files(text, integer) from public, anon;
grant execute on function public.admin_photo_files(text, integer) to authenticated;

create or replace function public.admin_photo_trash_batch(p_limit integer default 50) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v text[];
begin
  perform private.require_admin();
  select coalesce(array_agg(path), '{}') into v from (
    select path from private.photo_trash order by queued_at limit least(greatest(p_limit, 1), 200)
  ) t;
  return v;
end $$;
revoke all on function public.admin_photo_trash_batch(integer) from public, anon;
grant execute on function public.admin_photo_trash_batch(integer) to authenticated;

create or replace function public.admin_photo_trash_done(p_paths text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from private.photo_files where path = any (p_paths);
  delete from private.photo_trash where path = any (p_paths);
end $$;
revoke all on function public.admin_photo_trash_done(text[]) from public, anon;
grant execute on function public.admin_photo_trash_done(text[]) to authenticated;
