"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LIMITS, createGameApi, errorMessage, generatePlayerSecret, normalizeDisplayName, toAppError, type JoinInfo,
} from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { PlayerGame } from "./PlayerGame";
import { clearPlayer, loadPlayer, savePlayer, type StoredPlayer } from "./storage";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "closed"; info: JoinInfo; message: string }
  | { kind: "name"; info: JoinInfo }
  | { kind: "play"; player: StoredPlayer };

const REASONS: Record<string, string> = {
  session_ended: "This game has ended.",
  late_join_disabled: "This game has already started and isn't accepting new players.",
};

/** Browser player: join with a name, then play. */
export function PlayerApp({ joinToken }: { joinToken: string }) {
  const [api] = useState(() => createGameApi(getSupabase()));
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const resolve = useCallback(async (): Promise<Phase> => {
    try {
      const info = await api.getJoinInfo(joinToken);
      const saved = loadPlayer(joinToken);
      if (saved && saved.sessionId === info.sessionId && saved.participantId) {
        // Reconnect as the same player.
        try {
          await api.playerState(info.sessionId, saved.secret);
          return { kind: "play", player: saved };
        } catch (e) {
          const code = toAppError(e).code;
          if (code === "player_removed") return { kind: "error", message: errorMessage(e) };
          if (code !== "invalid_player") throw e;
          clearPlayer(joinToken);
        }
      }
      if (!info.joinable) {
        return { kind: "closed", info, message: REASONS[info.reason ?? ""] ?? "This game isn't accepting players." };
      }
      return { kind: "name", info };
    } catch (e) {
      return { kind: "error", message: errorMessage(e) };
    }
  }, [api, joinToken]);

  const start = useCallback(() => {
    setPhase({ kind: "loading" });
    void resolve().then(setPhase);
  }, [resolve]);

  useEffect(() => {
    // Initial state is already "loading".
    void resolve().then(setPhase);
  }, [resolve]);

  if (phase.kind === "play") {
    return (
      <PlayerGame
        sessionId={phase.player.sessionId}
        secret={phase.player.secret}
        onLeave={() => {
          clearPlayer(joinToken);
          start();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-stage px-5 py-6 text-white">
      <Logo inverted />
      <div className="mx-auto mt-14 w-full max-w-sm flex-1">
        {phase.kind === "loading" && (
          <p className="text-center text-white/60" role="status">
            Finding the game…
          </p>
        )}
        {phase.kind === "error" && (
          <div className="text-center">
            <p className="text-xl font-semibold">{phase.message}</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button size="lg" onClick={start}>
                Try again
              </Button>
              <Link href="/join" className="py-2 text-sm text-white/60 underline">
                Enter a room code instead
              </Link>
            </div>
          </div>
        )}
        {phase.kind === "closed" && (
          <div className="text-center">
            <p className="text-sm uppercase tracking-wider text-white/50">{phase.info.title}</p>
            <p className="mt-2 text-xl font-semibold">{phase.message}</p>
          </div>
        )}
        {phase.kind === "name" && (
          <NameForm
            info={phase.info}
            onJoin={async (name) => {
              // Keep the same secret across retries so a repeated tap never
              // creates a second player.
              const existing = loadPlayer(joinToken);
              const secret = existing?.sessionId === phase.info.sessionId ? existing.secret : generatePlayerSecret();
              savePlayer(joinToken, { sessionId: phase.info.sessionId, secret, savedAt: Date.now() });
              const r = await api.join(joinToken, name, secret);
              const player = { sessionId: r.sessionId, secret, participantId: r.participantId, displayName: r.displayName, savedAt: Date.now() };
              savePlayer(joinToken, player);
              setPhase({ kind: "play", player });
            }}
          />
        )}
      </div>
    </div>
  );
}

function NameForm({ info, onJoin }: { info: JoinInfo; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = normalizeDisplayName(name);
    if (!n.ok) return setError(n.error);
    setBusy(true);
    setError(null);
    try {
      await onJoin(n.name);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };
  return (
    <form onSubmit={submit}>
      <p className="text-sm uppercase tracking-wider text-white/50">You&apos;re joining</p>
      <h1 className="mt-1 text-2xl font-semibold">{info.title}</h1>
      <label htmlFor="name" className="mt-8 block text-sm font-medium text-white/80">
        Your name
      </label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={LIMITS.displayName}
        autoComplete="nickname"
        autoFocus
        enterKeyHint="go"
        placeholder="Enter your name"
        className="mt-2 h-14 w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 text-xl text-white placeholder:text-white/30 focus:border-white/60 focus:outline-none"
      />
      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
        Join game
      </Button>
      <p className="mt-4 text-center text-xs text-white/40">No account needed. Your name is only shown in this game.</p>
    </form>
  );
}
