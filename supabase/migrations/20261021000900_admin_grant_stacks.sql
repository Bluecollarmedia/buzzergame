-- Time granted by an admin is added after the host's current access ends,
-- the same way redeemed codes work, instead of overlapping it.
create or replace function public.admin_grant_entitlement(p_user_id uuid, p_duration_hours integer, p_plan text default 'standard')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_plan text := coalesce(p_plan, 'standard');
  v_start timestamptz;
  v_id uuid;
begin
  if p_duration_hours is null or p_duration_hours < 1 then perform private.raise('invalid_request'); end if;
  -- Serialise grants for this host so two at once both stack.
  perform 1 from public.profiles where id = p_user_id for update;
  select greatest(now(), coalesce(max(expires_at), now())) into v_start
  from public.entitlements where user_id = p_user_id and status = 'active' and plan = v_plan and expires_at > now();
  insert into public.entitlements (user_id, plan, starts_at, expires_at, source)
  values (p_user_id, v_plan, v_start, v_start + make_interval(hours => p_duration_hours), 'admin')
  returning id into v_id;
  perform private.audit('admin', v_uid, null, 'entitlement.granted', jsonb_build_object('userId', p_user_id, 'hours', p_duration_hours));
  return v_id;
end $$;

revoke all on function public.admin_grant_entitlement(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_entitlement(uuid, integer, text) to authenticated;
