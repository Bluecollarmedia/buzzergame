import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { SessionSync, type AppError, type ConnectionStatus, type ServerClock, type SyncedState } from "@crowdquiz/shared";
import { getSupabase } from "./supabase";

/** React Native binding for the shared SessionSync. */
export function useSessionSync<T extends SyncedState>(opts: {
  sessionId: string;
  fetchState: () => Promise<T>;
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

  useEffect(() => {
    const sync = new SessionSync<T>({
      supabase: getSupabase(),
      sessionId: opts.sessionId,
      fetchState: () => fetchRef.current(),
      events: ["state", "roster"],
      heartbeatMs: opts.heartbeatMs,
      onState: setState,
      onConnection: setConnection,
      onFatalError: setFatal,
    });
    syncRef.current = sync;
    setClock(sync.clock);
    sync.start();
    // Coming back to the app: catch up straight away.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync.resync();
    });
    return () => {
      sub.remove();
      sync.stop();
      syncRef.current = null;
    };
  }, [opts.sessionId, opts.heartbeatMs]);

  return { state, connection, fatal, clock, refresh: () => syncRef.current?.refresh() };
}

/** Milliseconds left until a server deadline, re-rendering ~10 times a second. */
export function useCountdown(clock: ServerClock | null, deadline: string | null | undefined, frozenMs?: number | null) {
  const [, setTick] = useState(0);
  const frozen = frozenMs !== undefined && frozenMs !== null;
  useEffect(() => {
    if (frozen || !clock || !deadline) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const r = clock.remainingMs(deadline);
      if (r !== null && r <= 0) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [clock, deadline, frozen]);
  if (frozen) return frozenMs;
  if (!clock || !deadline) return null;
  return clock.remainingMs(deadline);
}
