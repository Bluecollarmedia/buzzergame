-- Host accounts, quiz editing helpers, access codes and administrator tools.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Quiz editing
-- ---------------------------------------------------------------------------
create or replace function private.owned_quiz(p_quiz_id uuid) returns public.quizzes
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  qz public.quizzes;
begin
  select * into qz from public.quizzes where id = p_quiz_id and owner_id = v_uid;
  if qz.id is null then perform private.raise('not_found'); end if;
  return qz;
end $$;

-- A quiz can only be marked ready when every question is playable.
create or replace function private.quiz_status_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_problems text[];
begin
  if new.status = 'ready' then
    v_problems := private.quiz_problems(new.id);
    if array_length(v_problems, 1) > 0 then
      if tg_op = 'UPDATE' and old.status = 'ready' then
        -- Already marked ready and edited into an unplayable state: back to draft.
        new.status := 'draft';
      else
        perform private.raise('quiz_invalid', array_to_string(v_problems, '; '));
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists quizzes_status_guard on public.quizzes;
create trigger quizzes_status_guard before insert or update on public.quizzes
  for each row execute function private.quiz_status_guard();

-- Editing a question touches the quiz and drops it back to draft if it is
-- no longer playable.
create or replace function private.question_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_quiz uuid := coalesce(new.quiz_id, old.quiz_id);
begin
  update public.quizzes set
    updated_at = now(),
    status = case when status = 'ready' and array_length(private.quiz_problems(v_quiz), 1) > 0 then 'draft'::public.quiz_status else status end
  where id = v_quiz;
  return null;
end $$;

drop trigger if exists questions_changed on public.questions;
create trigger questions_changed after insert or update or delete on public.questions
  for each row execute function private.question_changed();

create or replace function public.add_question(p_quiz_id uuid, p_after_position integer default null)
returns public.questions language plpgsql volatile security definer set search_path = '' as $$
declare
  qz public.quizzes := private.owned_quiz(p_quiz_id);
  v_pos integer;
  q public.questions;
begin
  perform 1 from public.quizzes where id = qz.id for update;
  if (select count(*) from public.questions where quiz_id = qz.id) >= 200 then
    perform private.raise('too_many_questions');
  end if;
  if p_after_position is null then
    select coalesce(max(position), -1) + 1 into v_pos from public.questions where quiz_id = qz.id;
  else
    v_pos := p_after_position + 1;
    set constraints public.questions_position_unique deferred;
    update public.questions set position = position + 1 where quiz_id = qz.id and position >= v_pos;
  end if;
  insert into public.questions (quiz_id, position) values (qz.id, v_pos) returning * into q;
  return q;
end $$;

create or replace function public.duplicate_question(p_question_id uuid)
returns public.questions language plpgsql volatile security definer set search_path = '' as $$
declare
  src public.questions;
  q public.questions;
begin
  select * into src from public.questions where id = p_question_id;
  if src.id is null then perform private.raise('not_found'); end if;
  perform private.owned_quiz(src.quiz_id);
  perform 1 from public.quizzes where id = src.quiz_id for update;
  set constraints public.questions_position_unique deferred;
  update public.questions set position = position + 1 where quiz_id = src.quiz_id and position > src.position;
  insert into public.questions (quiz_id, position, kind, prompt, choices, correct_index, time_limit_seconds, media)
  values (src.quiz_id, src.position + 1, src.kind, src.prompt, src.choices, src.correct_index, src.time_limit_seconds, src.media)
  returning * into q;
  return q;
end $$;

create or replace function public.delete_question(p_question_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  src public.questions;
begin
  select * into src from public.questions where id = p_question_id;
  if src.id is null then perform private.raise('not_found'); end if;
  perform private.owned_quiz(src.quiz_id);
  perform 1 from public.quizzes where id = src.quiz_id for update;
  delete from public.questions where id = src.id;
  set constraints public.questions_position_unique deferred;
  update public.questions set position = position - 1 where quiz_id = src.quiz_id and position > src.position;
end $$;

-- Set the order of all questions in one atomic step.
create or replace function public.reorder_questions(p_quiz_id uuid, p_question_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  qz public.quizzes := private.owned_quiz(p_quiz_id);
  v_total integer;
begin
  perform 1 from public.quizzes where id = qz.id for update;
  select count(*) into v_total from public.questions where quiz_id = qz.id;
  if coalesce(array_length(p_question_ids, 1), 0) <> v_total
     or (select count(distinct x) from unnest(p_question_ids) x) <> v_total
     or exists (select 1 from unnest(p_question_ids) x where x not in (select id from public.questions where quiz_id = qz.id)) then
    perform private.raise('invalid_request', 'question list does not match quiz');
  end if;
  set constraints public.questions_position_unique deferred;
  update public.questions q set position = o.ord - 1
  from unnest(p_question_ids) with ordinality as o(id, ord)
  where q.id = o.id and q.quiz_id = qz.id;
end $$;

create or replace function public.duplicate_quiz(p_quiz_id uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  qz public.quizzes := private.owned_quiz(p_quiz_id);
  v_new uuid;
begin
  if (select count(*) from public.quizzes where owner_id = qz.owner_id) >= 500 then
    perform private.raise('too_many_quizzes');
  end if;
  insert into public.quizzes (owner_id, title, description, mode, status, settings)
  values (qz.owner_id, left('Copy of ' || qz.title, 120), qz.description, qz.mode, 'draft', qz.settings)
  returning id into v_new;
  insert into public.questions (quiz_id, position, kind, prompt, choices, correct_index, time_limit_seconds, media)
  select v_new, position, kind, prompt, choices, correct_index, time_limit_seconds, media
  from public.questions where quiz_id = qz.id;
  return v_new;
end $$;

create or replace function public.quiz_issues(p_quiz_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.owned_quiz(p_quiz_id);
  return private.quiz_problems(p_quiz_id);
end $$;

-- Limit the number of quizzes per host (abuse protection).
create or replace function private.quiz_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.quizzes where owner_id = new.owner_id) >= 500 then
    perform private.raise('too_many_quizzes');
  end if;
  if exists (select 1 from public.profiles where id = new.owner_id and disabled) then
    perform private.raise('account_disabled');
  end if;
  return new;
end $$;

drop trigger if exists quizzes_quota on public.quizzes;
create trigger quizzes_quota before insert on public.quizzes
  for each row execute function private.quiz_quota();

-- ---------------------------------------------------------------------------
-- Entitlements and access codes
-- ---------------------------------------------------------------------------
create or replace function private.normalize_access_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.my_entitlement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  e public.entitlements;
  v_used integer := 0;
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
    'active', e.id is not null or private.is_admin(v_uid),
    'isAdmin', private.is_admin(v_uid),
    'plan', e.plan,
    'startsAt', e.starts_at,
    'expiresAt', (select max(expires_at) from public.entitlements where user_id = v_uid and status = 'active' and expires_at > now()),
    'currentExpiresAt', e.expires_at,
    'source', e.source,
    'maxSessions', e.max_sessions,
    'sessionsUsed', v_used,
    'serverNow', now()
  );
end $$;

create or replace function public.redeem_access_code(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_host();
  c public.access_codes;
  v_start timestamptz;
  v_ent uuid;
  v_expires timestamptz;
begin
  perform private.rate_limit('redeem:' || v_uid, 10, 600);
  -- Row lock: concurrent redemptions of a multi-use code are serialized,
  -- so the redemption limit can never be exceeded.
  select * into c from public.access_codes
  where code_hash = private.sha256_hex(private.normalize_access_code(p_code))
  for update;
  -- Soft errors so failed attempts still count against the rate limit.
  if c.id is null then return private.soft_error('code_invalid'); end if;
  if c.revoked_at is not null then return private.soft_error('code_revoked'); end if;
  if c.expires_at is not null and c.expires_at <= now() then return private.soft_error('code_expired'); end if;
  if c.redemption_count >= c.max_redemptions then return private.soft_error('code_exhausted'); end if;
  if exists (select 1 from public.access_code_redemptions where code_id = c.id and user_id = v_uid) then
    return private.soft_error('code_already_redeemed');
  end if;

  -- New access starts when the host's current access for the same plan ends.
  select greatest(now(), coalesce(max(expires_at), now())) into v_start
  from public.entitlements where user_id = v_uid and status = 'active' and plan = c.plan and expires_at > now();
  v_expires := v_start + c.access_duration;

  insert into public.entitlements (user_id, plan, features, starts_at, expires_at, source, source_ref, max_sessions)
  values (v_uid, c.plan, c.features, v_start, v_expires, 'access_code', c.id, c.max_sessions)
  returning id into v_ent;
  insert into public.access_code_redemptions (code_id, user_id, entitlement_id) values (c.id, v_uid, v_ent);
  update public.access_codes set redemption_count = redemption_count + 1 where id = c.id;

  perform private.audit('host', v_uid, null, 'access_code.redeemed', jsonb_build_object('codeId', c.id, 'entitlementId', v_ent));
  return jsonb_build_object('entitlementId', v_ent, 'plan', c.plan, 'startsAt', v_start, 'expiresAt', v_expires);
end $$;

-- ---------------------------------------------------------------------------
-- Administrator tools
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_access_code(
  p_duration_hours integer,
  p_max_redemptions integer default 1,
  p_expires_at timestamptz default null,
  p_plan text default 'standard',
  p_note text default null,
  p_max_sessions integer default null,
  p_code text default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_code text;
  v_norm text;
  v_id uuid;
begin
  if p_duration_hours is null or p_duration_hours < 1 or p_duration_hours > 24 * 3660 then
    perform private.raise('invalid_request', 'duration must be between 1 hour and 10 years');
  end if;
  if p_code is not null and btrim(p_code) <> '' then
    v_norm := private.normalize_access_code(p_code);
    if char_length(v_norm) < 8 or char_length(v_norm) > 32 then
      perform private.raise('invalid_request', 'custom codes need 8-32 letters or digits');
    end if;
    v_code := upper(btrim(p_code));
  else
    v_norm := private.random_code(12);
    v_code := substr(v_norm, 1, 4) || '-' || substr(v_norm, 5, 4) || '-' || substr(v_norm, 9, 4);
  end if;
  begin
    insert into public.access_codes (code_hash, code_hint, plan, access_duration, max_redemptions, max_sessions, expires_at, note, created_by)
    values (private.sha256_hex(v_norm), substr(v_norm, 1, 4), coalesce(p_plan, 'standard'),
      make_interval(hours => p_duration_hours), coalesce(p_max_redemptions, 1), p_max_sessions, p_expires_at,
      nullif(btrim(coalesce(p_note, '')), ''), v_uid)
    returning id into v_id;
  exception when unique_violation then
    perform private.raise('code_exists');
  end;
  perform private.audit('admin', v_uid, null, 'access_code.created', jsonb_build_object(
    'codeId', v_id, 'hint', substr(v_norm, 1, 4), 'durationHours', p_duration_hours, 'maxRedemptions', p_max_redemptions));
  -- The plaintext code is returned exactly once and never stored.
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create or replace function public.admin_list_access_codes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'hint', c.code_hint, 'plan', c.plan,
      'durationHours', (extract(epoch from c.access_duration) / 3600)::integer,
      'maxRedemptions', c.max_redemptions, 'redemptionCount', c.redemption_count, 'maxSessions', c.max_sessions,
      'expiresAt', c.expires_at, 'revokedAt', c.revoked_at, 'note', c.note, 'createdAt', c.created_at,
      'status', case
        when c.revoked_at is not null then 'revoked'
        when c.expires_at is not null and c.expires_at <= now() then 'expired'
        when c.redemption_count >= c.max_redemptions then 'redeemed'
        else 'active' end
    ) order by c.created_at desc), '[]'::jsonb) from public.access_codes c);
end $$;

create or replace function public.admin_revoke_access_code(p_code_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  update public.access_codes set revoked_at = now() where id = p_code_id and revoked_at is null;
  if not found then perform private.raise('not_found'); end if;
  perform private.audit('admin', v_uid, null, 'access_code.revoked', jsonb_build_object('codeId', p_code_id));
end $$;

create or replace function public.admin_list_hosts(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(row_to_json(h)::jsonb order by h."createdAt" desc), '[]'::jsonb) from (
    select u.id, u.email, p.display_name as "displayName", p.disabled, p.disabled_reason as "disabledReason",
      u.created_at as "createdAt", u.last_sign_in_at as "lastSignInAt",
      private.is_admin(u.id) as "isAdmin",
      (select max(e.expires_at) from public.entitlements e where e.user_id = u.id and e.status = 'active') as "accessExpiresAt",
      (select count(*) from public.quizzes q where q.owner_id = u.id) as "quizCount",
      (select count(*) from public.game_sessions g where g.host_id = u.id) as "sessionCount"
    from auth.users u left join public.profiles p on p.id = u.id
    where p_search is null or btrim(p_search) = ''
      or u.email ilike '%' || btrim(p_search) || '%' or p.display_name ilike '%' || btrim(p_search) || '%'
    order by u.created_at desc limit 200
  ) h);
end $$;

create or replace function public.admin_set_host_disabled(p_user_id uuid, p_disabled boolean, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_sid uuid;
begin
  if p_user_id = v_uid then perform private.raise('invalid_request', 'you cannot disable your own account'); end if;
  update public.profiles set disabled = p_disabled, disabled_reason = case when p_disabled then p_reason else null end
  where id = p_user_id;
  if not found then perform private.raise('not_found'); end if;
  if p_disabled then
    for v_sid in select id from public.game_sessions where host_id = p_user_id and status not in ('finished', 'aborted') for update loop
      perform private.finish(v_sid, 'aborted');
    end loop;
  end if;
  perform private.audit('admin', v_uid, null, case when p_disabled then 'host.disabled' else 'host.enabled' end,
    jsonb_build_object('userId', p_user_id, 'reason', p_reason));
end $$;

create or replace function public.admin_grant_entitlement(p_user_id uuid, p_duration_hours integer, p_plan text default 'standard')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid;
begin
  if p_duration_hours is null or p_duration_hours < 1 then perform private.raise('invalid_request'); end if;
  insert into public.entitlements (user_id, plan, starts_at, expires_at, source)
  values (p_user_id, coalesce(p_plan, 'standard'), now(), now() + make_interval(hours => p_duration_hours), 'admin')
  returning id into v_id;
  perform private.audit('admin', v_uid, null, 'entitlement.granted', jsonb_build_object('userId', p_user_id, 'hours', p_duration_hours));
  return v_id;
end $$;

create or replace function public.admin_revoke_entitlements(p_user_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  n integer;
begin
  update public.entitlements set status = 'revoked' where user_id = p_user_id and status = 'active';
  get diagnostics n = row_count;
  perform private.audit('admin', v_uid, null, 'entitlement.revoked', jsonb_build_object('userId', p_user_id, 'count', n));
  return n;
end $$;

create or replace function public.admin_list_sessions(p_live_only boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."createdAt" desc), '[]'::jsonb) from (
    select g.id, g.quiz_title as title, g.mode, g.status, g.created_at as "createdAt", g.updated_at as "updatedAt",
      u.email as "hostEmail",
      (select count(*) from public.participants p where p.session_id = g.id and p.removed_at is null) as "playerCount"
    from public.game_sessions g join auth.users u on u.id = g.host_id
    where not p_live_only or g.status not in ('finished', 'aborted')
    order by g.created_at desc limit 200
  ) x);
end $$;

create or replace function public.admin_end_session(p_session_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  s public.game_sessions;
begin
  select * into s from public.game_sessions where id = p_session_id for update;
  if s.id is null then perform private.raise('not_found'); end if;
  if s.status in ('finished', 'aborted') then return; end if;
  perform private.finish(s.id, 'aborted');
  perform private.audit('admin', v_uid, s.id, 'session.aborted_by_admin');
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'hosts', (select count(*) from auth.users),
    'disabledHosts', (select count(*) from public.profiles where disabled),
    'activeEntitlements', (select count(distinct user_id) from public.entitlements where status = 'active' and starts_at <= now() and expires_at > now()),
    'liveSessions', (select count(*) from public.game_sessions where status not in ('finished', 'aborted')),
    'sessions24h', (select count(*) from public.game_sessions where created_at > now() - interval '24 hours'),
    'players24h', (select count(*) from public.participants where joined_at > now() - interval '24 hours'),
    'stalledSessions', (select count(*) from public.game_sessions
      where status in ('countdown', 'question_open', 'reveal', 'leaderboard')
        and coalesce(phase_ends_at, question_deadline) < now() - interval '30 seconds'),
    'activeCodes', (select count(*) from public.access_codes where revoked_at is null
      and (expires_at is null or expires_at > now()) and redemption_count < max_redemptions),
    'serverNow', now()
  );
end $$;

create or replace function public.admin_audit_log(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'actorType', a.actor_type, 'actorId', a.actor_id, 'actorEmail', u.email,
      'sessionId', a.session_id, 'action', a.action, 'details', a.details, 'createdAt', a.created_at
    ) order by a.id desc), '[]'::jsonb)
    from (select * from public.audit_log order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) a
    left join auth.users u on u.id = a.actor_id);
end $$;
