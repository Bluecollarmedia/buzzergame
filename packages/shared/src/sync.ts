import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { ServerClock } from "./clock";
import { AppError, toAppError } from "./errors";
import type { SessionCore } from "./types";

export type ConnectionStatus =
  /** First load in progress. */
  | "connecting"
  /** Realtime connected and state is fresh. */
  | "live"
  /** Realtime unavailable; state is kept fresh by periodic requests. */
  | "polling"
  /** Requests are failing; retrying with backoff. */
  | "reconnecting";

export interface SyncedState {
  serverNow: string;
  session: SessionCore;
  question?: { deadline?: string | null; roundStatus?: string | null } | null;
}

export interface SessionSyncOptions<T extends SyncedState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>;
  sessionId: string;
  /** Fetch the authoritative state (player_state / projector_state / host_state). */
  fetchState: () => Promise<T>;
  /** Broadcast events that should trigger a refresh. */
  events?: Array<"state" | "roster" | "answers">;
  onState: (state: T) => void;
  onConnection?: (status: ConnectionStatus) => void;
  /** Called for errors that will not fix themselves (e.g. removed player). */
  onFatalError?: (err: AppError) => void;
  /** Refresh interval while realtime is connected (safety net). */
  heartbeatMs?: number;
  /** Refresh interval while realtime is not connected. */
  pollMs?: number;
  /** Ask the server to advance when a deadline passes (default true). */
  autoTick?: boolean;
  /** Override timers in tests. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
  now?: () => number;
}

const FATAL_CODES = new Set(["invalid_player", "player_removed", "session_not_found", "not_found", "forbidden"]);

/**
 * Keeps one screen in sync with a live session.
 *
 * - Realtime broadcast messages only say "something changed"; the state
 *   itself is always re-read from the database, so a missed message can
 *   never leave a client with wrong data.
 * - A slow heartbeat (or faster polling when realtime is down) recovers
 *   from dropped connections without refreshing the page.
 * - When the server deadline passes, the client asks the server to advance
 *   (tick_session). The server decides using its own clock.
 */
export class SessionSync<T extends SyncedState> {
  readonly clock: ServerClock;
  private channel: RealtimeChannel | null = null;
  private realtimeUp = false;
  private stopped = true;
  private inFlight = false;
  private dirty = false;
  private failures = 0;
  private state: T | null = null;
  private status: ConnectionStatus = "connecting";
  private pollTimer: unknown = null;
  private tickTimer: unknown = null;
  private debounceTimer: unknown = null;
  private tickedFor = new Set<string>();
  private readonly t: NonNullable<SessionSyncOptions<T>["timers"]>;

  constructor(private opts: SessionSyncOptions<T>) {
    this.clock = new ServerClock(opts.now);
    this.t = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  get current(): T | null {
    return this.state;
  }

  get connection(): ConnectionStatus {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.subscribe();
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer("pollTimer");
    this.clearTimer("tickTimer");
    this.clearTimer("debounceTimer");
    if (this.channel) {
      void this.opts.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  /** Force a refresh now (call on focus / network "online" events). */
  resync(): void {
    if (this.stopped) return;
    this.failures = 0;
    if (!this.channel) this.subscribe();
    void this.refresh();
  }

  /** Apply a state obtained elsewhere (e.g. right after a command). */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.inFlight = true;
    const now = this.opts.now ?? Date.now;
    const t0 = now();
    try {
      const next = await this.opts.fetchState();
      const t1 = now();
      if (this.stopped) return;
      this.clock.addSample(next.serverNow, t0, t1);
      this.failures = 0;
      // Never go backwards: ignore a response older than what we have.
      if (!this.state || next.session.stateVersion >= this.state.session.stateVersion) {
        this.state = next;
        this.opts.onState(next);
      }
      this.setStatus(this.realtimeUp ? "live" : "polling");
      this.scheduleTick();
    } catch (err) {
      const e = toAppError(err);
      if (FATAL_CODES.has(e.code)) {
        this.opts.onFatalError?.(e);
        this.stop();
        return;
      }
      this.failures += 1;
      this.setStatus("reconnecting");
    } finally {
      this.inFlight = false;
      if (!this.stopped) {
        if (this.dirty) {
          this.dirty = false;
          void this.refresh();
        } else {
          this.schedulePoll();
        }
      }
    }
  }

  private setStatus(s: ConnectionStatus) {
    if (s !== this.status) {
      this.status = s;
      this.opts.onConnection?.(s);
    }
  }

  private clearTimer(k: "pollTimer" | "tickTimer" | "debounceTimer") {
    if (this[k] !== null) {
      this.t.clearTimeout(this[k]);
      this[k] = null;
    }
  }

  private schedulePoll() {
    this.clearTimer("pollTimer");
    let ms: number;
    if (this.failures > 0) {
      // Exponential backoff with jitter: 1s, 2s, 4s ... up to 15s.
      ms = Math.min(15000, 1000 * 2 ** (this.failures - 1)) * (0.75 + Math.random() * 0.5);
    } else if (this.realtimeUp) {
      ms = this.opts.heartbeatMs ?? 20000;
    } else {
      ms = this.opts.pollMs ?? 2000;
    }
    this.pollTimer = this.t.setTimeout(() => {
      this.pollTimer = null;
      void this.refresh();
    }, ms);
  }

  /** When the current phase ends on the server clock, ask the server to advance. */
  private scheduleTick() {
    this.clearTimer("tickTimer");
    if (this.opts.autoTick === false || !this.state) return;
    const s = this.state.session;
    let due: string | null = null;
    if (s.status === "question_open") due = this.state.question?.deadline ?? null;
    else if (s.status === "countdown" || s.status === "reveal" || s.status === "leaderboard") due = s.phaseEndsAt;
    if (!due) return;
    const key = `${s.stateVersion}:${due}`;
    const remaining = this.clock.remainingMs(due) ?? 0;
    // Small random delay spreads requests from many devices.
    const delay = remaining + 120 + Math.random() * 250;
    this.tickTimer = this.t.setTimeout(async () => {
      this.tickTimer = null;
      if (this.stopped || this.tickedFor.has(key)) {
        // Already ticked for this phase; rely on refresh/heartbeat.
        void this.refresh();
        return;
      }
      this.tickedFor.add(key);
      if (this.tickedFor.size > 50) this.tickedFor = new Set([key]);
      try {
        await this.opts.supabase.rpc("tick_session", { p_session_id: this.opts.sessionId });
      } catch {
        /* the refresh below will retry */
      }
      void this.refresh();
    }, delay);
  }

  private subscribe() {
    const events = new Set(this.opts.events ?? ["state"]);
    try {
      const ch = this.opts.supabase.channel(`session:${this.opts.sessionId}`, {
        config: { broadcast: { self: false } },
      });
      ch.on("broadcast", { event: "*" }, (msg: { event: string }) => {
        if (!events.has(msg.event as "state")) return;
        if (msg.event === "state") {
          void this.refresh();
        } else {
          // Coalesce bursts (many players answering at once).
          if (this.debounceTimer === null) {
            this.debounceTimer = this.t.setTimeout(() => {
              this.debounceTimer = null;
              void this.refresh();
            }, 350);
          }
        }
      });
      ch.subscribe((status: string) => {
        if (this.stopped) return;
        if (status === "SUBSCRIBED") {
          const wasDown = !this.realtimeUp;
          this.realtimeUp = true;
          // Catch up on anything missed while disconnected.
          if (wasDown) void this.refresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.realtimeUp = false;
          if (this.status === "live") this.setStatus("polling");
          this.schedulePoll();
        }
      });
      this.channel = ch;
    } catch {
      this.realtimeUp = false;
    }
  }
}
