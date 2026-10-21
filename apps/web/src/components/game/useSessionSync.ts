"use client";

import { useEffect, useRef, useState } from "react";
import { SessionSync, type AppError, type ConnectionStatus, type ServerClock, type SyncedState } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";

/**
 * React binding for SessionSync: keeps `state` equal to the latest
 * authoritative server state for this session.
 */
export function useSessionSync<T extends SyncedState>(opts: {
  sessionId: string | null;
  fetchState: () => Promise<T>;
  events?: Array<"state" | "roster" | "answers">;
  heartbeatMs?: number;
}) {
  const [state, setState] = useState<T | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [fatal, setFatal] = useState<AppError | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const syncRef = useRef<SessionSync<T> | null>(null);
  const fetchRef = useRef(opts.fetchState);
  useEffect(() => {
    fetchRef.current = opts.fetchState;
  }, [opts.fetchState]);
  const eventsKey = (opts.events ?? ["state"]).join(",");

  useEffect(() => {
    if (!opts.sessionId) return;
    const sync = new SessionSync<T>({
      supabase: getSupabase(),
      sessionId: opts.sessionId,
      fetchState: () => fetchRef.current(),
      events: eventsKey.split(",") as Array<"state" | "roster" | "answers">,
      heartbeatMs: opts.heartbeatMs,
      onState: (s) => setState(s),
      onConnection: setConnection,
      onFatalError: setFatal,
    });
    syncRef.current = sync;
    setClock(sync.clock);
    sync.start();
    const resync = () => sync.resync();
    const onVisible = () => document.visibilityState === "visible" && sync.resync();
    window.addEventListener("online", resync);
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", resync);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisible);
      sync.stop();
      syncRef.current = null;
    };
  }, [opts.sessionId, eventsKey, opts.heartbeatMs]);

  return {
    state,
    connection,
    fatal,
    clock,
    refresh: () => syncRef.current?.refresh(),
  };
}
