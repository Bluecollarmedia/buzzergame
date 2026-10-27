-- Admin switches.
--
--  * Free hosting: when on, anyone who is signed in can host games without an
--    access code, with no game limit and the larger photo allowance. Turning
--    it off brings back the normal rules. Access codes and admin grants are
--    never touched by the switch.
--  * Photo uploads: when off, nobody (admins included) can upload new question
--    photos. Photos already on quizzes stay and still show in games.

create table if not exists private.app_settings (
  id boolean primary key default true check (id),
  free_hosting boolean not null default false,
  photo_uploads boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into private.app_settings (id) values (true) on conflict (id) do nothing;
revoke all on private.app_settings from public, anon, authenticated;

create or replace function private.free_hosting() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select free_hosting from private.app_settings where id), false);
$$;

create or replace function private.photo_uploads_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select photo_uploads from private.app_settings where id), true);
$$;

-- ---------------------------------------------------------------------------
-- Hosting checks
-- ---------------------------------------------------------------------------
create or replace function private.assert_can_host(p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.entitlements;
  v_used integer;
begin
  if private.is_admin(p_uid) or private.free_hosting() then return; end if;
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

create or replace function public.my_entitlement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  e public.entitlements;
  v_used integer := 0;
  v_free boolean := private.free_hosting();
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  select * into e from public.entitlements
  where user_id = v_uid and status = 'active' and starts_at <= now() and expires_at > now()
  order by expires_at desc limit 1;
  if e.id is not null and e.max_sessions is not null then
    select count(*) into v_used from public.game_sessions
    where host_id = v_uid and created_at >= e.starts_at and status <> 'aborted';
  end if;
  return jsonb_build_object(
    'active', e.id is not null or private.is_admin(v_uid) or v_free,
    'isAdmin', private.is_admin(v_uid),
    'freeHosting', v_free,
    'plan', e.plan,
    'startsAt', e.starts_at,
    'expiresAt', (select max(expires_at) from public.entitlements where user_id = v_uid and status = 'active' and expires_at > now()),
    'currentExpiresAt', e.expires_at,
    'source', e.source,
    -- While hosting is free there is no game limit, so none is reported.
    'maxSessions', case when v_free then null else e.max_sessions end,
    'sessionsUsed', v_used,
    'serverNow', now()
  );
end $$;

create or replace function private.photo_limit(p_uid uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when not private.photo_uploads_enabled() then 0
    when private.is_admin(p_uid)
      or private.free_hosting()
      or exists (select 1 from public.entitlements
                 where user_id = p_uid and status = 'active' and starts_at <= now() and expires_at > now())
    then 200 else 10 end;
$$;

create or replace function public.my_photo_quota() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.raise('not_authenticated'); end if;
  return jsonb_build_object(
    'used', private.photos_used(v_uid),
    'limit', private.photo_limit(v_uid),
    'uploadsEnabled', private.photo_uploads_enabled()
  );
end $$;

-- New uploads are already blocked by photo_limit() returning 0 (see
-- can_add_photo() in the insert policy). Also stop overwriting an existing
-- file while uploads are off.
create or replace function public.photo_uploads_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.photo_uploads_enabled();
$$;
revoke all on function public.photo_uploads_enabled() from public, anon;
grant execute on function public.photo_uploads_enabled() to authenticated;

drop policy if exists question_images_update_own on storage.objects;
create policy question_images_update_own on storage.objects for update to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'question-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.photo_uploads_enabled()
  );

-- ---------------------------------------------------------------------------
-- Admin API
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s private.app_settings;
begin
  perform private.require_admin();
  select * into s from private.app_settings where id;
  return jsonb_build_object(
    'freeHosting', coalesce(s.free_hosting, false),
    'photoUploads', coalesce(s.photo_uploads, true),
    'updatedAt', s.updated_at
  );
end $$;

-- Pass only the switches to change; null leaves a switch as it is.
create or replace function public.admin_update_settings(
  p_free_hosting boolean default null,
  p_photo_uploads boolean default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  old private.app_settings;
begin
  select * into old from private.app_settings where id for update;
  update private.app_settings set
    free_hosting = coalesce(p_free_hosting, free_hosting),
    photo_uploads = coalesce(p_photo_uploads, photo_uploads),
    updated_at = now(),
    updated_by = v_uid
  where id;
  if p_free_hosting is not null and p_free_hosting is distinct from old.free_hosting then
    perform private.audit('admin', v_uid, null,
      case when p_free_hosting then 'settings.free_hosting_on' else 'settings.free_hosting_off' end);
  end if;
  if p_photo_uploads is not null and p_photo_uploads is distinct from old.photo_uploads then
    perform private.audit('admin', v_uid, null,
      case when p_photo_uploads then 'settings.photo_uploads_on' else 'settings.photo_uploads_off' end);
  end if;
  return public.admin_get_settings();
end $$;

revoke execute on function public.admin_get_settings() from public, anon;
revoke execute on function public.admin_update_settings(boolean, boolean) from public, anon;
grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_update_settings(boolean, boolean) to authenticated;
