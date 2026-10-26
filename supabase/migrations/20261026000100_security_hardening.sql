-- Security hardening from the pre-launch review.
--
-- 1. Room-code guessing gets a global cap as well as the per-address cap.
--    The per-address limit keys on the client IP reported in the request
--    headers. If a client could influence that header (for example by sending
--    its own X-Forwarded-For value), it could spread guesses across many
--    "addresses". A second bucket that is not keyed on the address caps the
--    total guess rate for the whole service, so a 6-character room code
--    (31^6 = 887 million possibilities) cannot be brute-forced regardless of
--    how the per-address limit behaves. The caps are far above what real
--    players generate: even 500 people joining one game within a minute
--    resolve the code about 500 times.
--
-- 2. Hosts can list (select) the photos in their own Storage folder. Without
--    a select policy, the Storage API's list() returns nothing for a host's
--    own folder, which stopped "delete my account" from removing the host's
--    photos before the account itself is deleted. Reading the photo bytes was
--    never gated by this policy (the bucket is public under unguessable
--    paths); this only lets a host see the names of their own files.

create or replace function public.resolve_room_code(p_room_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_room_code, ''), '[^A-Za-z0-9]', '', 'g'));
  s public.game_sessions;
begin
  perform private.rate_limit('room_code:' || private.client_ip(), 60, 60);
  -- Global backstop: at most 1500 room-code lookups per minute across all clients.
  perform private.rate_limit('room_code:all', 1500, 60);
  -- Soft errors so failed guesses still count against the rate limit.
  if v_code !~ '^[A-Z2-9]{6}$' then return private.soft_error('session_not_found'); end if;
  select * into s from public.game_sessions where room_code = v_code and status not in ('finished', 'aborted');
  if s.id is null then return private.soft_error('session_not_found'); end if;
  return jsonb_build_object('joinToken', s.join_token, 'sessionId', s.id, 'title', s.quiz_title);
end $$;

create or replace function public.get_join_info(p_join_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.game_sessions;
begin
  perform private.rate_limit('join_info:' || private.client_ip(), 300, 60);
  -- Global backstop against join-token guessing (tokens are 24 random characters).
  perform private.rate_limit('join_info:all', 3000, 60);
  select * into s from public.game_sessions where join_token = p_join_token;
  if s.id is null then perform private.raise('session_not_found'); end if;
  return jsonb_build_object(
    'sessionId', s.id, 'title', s.quiz_title, 'mode', s.mode, 'status', s.status,
    'joinable', private.joinable_reason(s) is null, 'reason', private.joinable_reason(s)
  );
end $$;

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
  -- Global backstop: at most 3000 join attempts per minute across all clients.
  perform private.rate_limit('join:all', 3000, 60);
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

-- The functions above already existed with these grants; restate them so a
-- fresh database that runs only this file ends up in the same state.
revoke all on function public.resolve_room_code(text) from public;
revoke all on function public.get_join_info(text) from public;
revoke all on function public.join_session(text, text, text) from public;
grant execute on function public.resolve_room_code(text) to anon, authenticated;
grant execute on function public.get_join_info(text) to anon, authenticated;
grant execute on function public.join_session(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: hosts can list their own photo folder (and nothing else)
-- ---------------------------------------------------------------------------
drop policy if exists question_images_select_own on storage.objects;
create policy question_images_select_own on storage.objects for select to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
