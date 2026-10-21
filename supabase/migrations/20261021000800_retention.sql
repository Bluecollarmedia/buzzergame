-- Data retention (see docs/privacy.md).
--
--  * Live games with no activity for 24 hours are cancelled.
--  * Finished or cancelled games, with their guest players, answers and
--    scores, are deleted 90 days after they end.
--  * Audit log entries are deleted after 365 days.
--  * Rate-limit counters are deleted after 1 hour.
--
-- Hosts can delete a finished game sooner from the dashboard (delete_session).

create or replace function private.purge_expired_data(
  p_session_days integer default 90,
  p_audit_days integer default 365
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_aborted integer;
  v_sessions integer;
  v_audit integer;
begin
  with stale as (
    update public.game_sessions
       set status = 'aborted', ended_at = now(), phase_ends_at = null, state_version = state_version + 1
     where status not in ('finished', 'aborted') and updated_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into v_aborted from stale;

  with gone as (
    delete from public.game_sessions
     where status in ('finished', 'aborted')
       and coalesce(ended_at, updated_at) < now() - make_interval(days => p_session_days)
    returning id
  )
  select count(*) into v_sessions from gone;

  delete from public.audit_log where created_at < now() - make_interval(days => p_audit_days);
  get diagnostics v_audit = row_count;

  delete from private.rate_limits where window_start < now() - interval '1 hour';

  if v_aborted + v_sessions > 0 then
    perform private.audit('system', null, null, 'retention.purge',
      jsonb_build_object('abortedIdle', v_aborted, 'deletedSessions', v_sessions, 'deletedAuditEntries', v_audit));
  end if;
  return jsonb_build_object('abortedIdle', v_aborted, 'deletedSessions', v_sessions, 'deletedAuditEntries', v_audit);
end $$;

revoke all on function private.purge_expired_data(integer, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('crowdquiz_retention') where exists (select 1 from cron.job where jobname = 'crowdquiz_retention');
      perform cron.schedule('crowdquiz_retention', '30 3 * * *', 'select private.purge_expired_data()');
    exception when others then
      raise notice 'crowdquiz_retention not scheduled: %', sqlerrm;
    end;
  end if;
end $$;
