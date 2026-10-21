-- Optional server-side backstop for automatic progression.
--
-- Clients already ask the server to advance (tick_session) when a deadline
-- passes, and the server decides using its own clock. This pg_cron job makes
-- progression continue even if every client is momentarily disconnected.
-- If pg_cron is not available the migration does nothing.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be enabled: %', sqlerrm;
      return;
    end;
    -- Sub-minute schedules need pg_cron 1.5+ (available on Supabase).
    begin
      perform cron.unschedule('crowdquiz_tick') where exists (select 1 from cron.job where jobname = 'crowdquiz_tick');
      perform cron.schedule('crowdquiz_tick', '2 seconds', 'select private.tick_due_sessions()');
    exception when others then
      raise notice 'crowdquiz_tick not scheduled: %', sqlerrm;
    end;
  end if;
end $$;
