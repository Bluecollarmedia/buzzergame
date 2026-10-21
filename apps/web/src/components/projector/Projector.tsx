"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Maximize, Minimize, Pause, Trophy, Users, Volume2, VolumeX } from "lucide-react";
import {
  ANSWER_COLORS, GAME_MODE_INFO, brand, buildJoinUrl, createGameApi, errorMessage, formatRoomCode, winners,
  type ProjectorState,
} from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { siteBaseUrl } from "@/lib/env";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";
import { ConnectionBadge } from "@/components/game/ConnectionBadge";
import { CountdownRing } from "@/components/game/CountdownRing";
import { Leaderboard } from "@/components/game/Leaderboard";
import { QrCode } from "@/components/game/QrCode";
import { QuestionStage } from "@/components/game/QuestionStage";
import { useCountdown } from "@/components/game/useCountdown";
import { useSessionSync } from "@/components/game/useSessionSync";
import { useGameAudio } from "./audio/useGameAudio";

/** Read-only, full-screen presentation view. Holds no host credentials. */
export function Projector({ token }: { token: string }) {
  const [api] = useState(() => createGameApi(getSupabase()));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const fetchState = useCallback(() => api.projectorState(token), [api, token]);

  useEffect(() => {
    fetchState()
      .then((s) => setSessionId(s.session.id))
      .catch((e) => setInitialError(errorMessage(e)));
  }, [fetchState]);

  const { state, connection, clock, fatal } = useSessionSync<ProjectorState>({
    sessionId,
    fetchState,
    events: ["state", "roster", "answers"],
    heartbeatMs: 15000,
  });

  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const s = state?.session;
  const q = state?.question;
  const deadline = s?.status === "question_open" ? q?.deadline : s?.status === "countdown" ? s.phaseEndsAt : null;
  const remaining = useCountdown(clock, deadline, s?.status === "paused" ? s.pausedRemainingMs : undefined);
  const audio = useGameAudio(state ?? null, clock);

  const err = initialError ?? fatal?.message;
  if (err) {
    return (
      <Stage>
        <div className="m-auto max-w-xl text-center">
          <Logo inverted className="justify-center text-2xl" />
          <p className="mt-8 text-2xl font-semibold">{err}</p>
          <p className="mt-2 text-white/60">Open the projector link again from the host controls.</p>
        </div>
      </Stage>
    );
  }
  if (!state || !s) {
    return (
      <Stage>
        <p className="m-auto text-xl text-white/60" role="status">
          Connecting…
        </p>
      </Stage>
    );
  }

  const effective = s.status === "paused" ? s.pausedFrom : s.status;
  const isMc = s.mode === "multiple_choice";
  const totalMs = effective === "question_open" && q?.deadline && q.startedAt ? Date.parse(q.deadline) - Date.parse(q.startedAt) : 3000;
  const joinUrl = state.join ? buildJoinUrl(siteBaseUrl(), state.join.joinToken) : "";
  const joinHost = siteBaseUrl().replace(/^https?:\/\//, "");

  return (
    <Stage>
      {/* Top bar */}
      <header className="flex items-center justify-between px-[3vw] pt-[2.2vw] text-[1.1vw]">
        <div className="flex items-center gap-[1.5vw]">
          <Logo inverted className="text-[1.3vw]" />
          <span className="text-white/50">{s.title}</span>
        </div>
        <div className="flex items-center gap-3">
          {s.currentPosition !== null && s.status !== "lobby" && s.status !== "finished" && (
            <span className="text-white/60">
              Question {s.currentPosition + 1} / {s.questionCount}
            </span>
          )}
          {state.join && s.status !== "lobby" && state.join.open && (
            <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-white/80">{formatRoomCode(state.join.roomCode)}</span>
          )}
          {connection !== "live" && <ConnectionBadge status={connection} tone="stage" />}
          {audio.hostOn && (
            <button
              onClick={() => void audio.toggle()}
              className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label={audio.playing ? "Turn sound off" : "Turn sound on"}
              aria-pressed={audio.playing}
              data-testid="projector-sound"
            >
              {audio.playing ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col px-[4vw] pb-[3vw] pt-[2vw]">
        {s.status === "lobby" && state.join && (
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-[4vw]">
            <div className="flex flex-col items-center">
              <div className="rounded-[2vw] bg-white p-[1.4vw] shadow-2xl">
                <QrCode value={joinUrl} className="size-[26vw] max-h-[60vh] max-w-[60vh] [&>svg]:size-full" />
              </div>
              <p className="mt-[2vw] text-[1.6vw] text-white/70">
                Scan to join, or go to <span className="font-semibold text-white">{joinHost}/join</span>
              </p>
              <p className="mt-[0.6vw] font-mono text-[4.5vw] font-bold tracking-[0.2em]" data-testid="projector-room-code">
                {formatRoomCode(state.join.roomCode)}
              </p>
            </div>
            <div className="flex h-full flex-col justify-center">
              <p className="text-[1.3vw] font-semibold uppercase tracking-[0.2em] text-white/50">{GAME_MODE_INFO[s.mode].name}</p>
              <h1 className="mt-[0.8vw] text-[3.6vw] font-semibold leading-tight">{s.title}</h1>
              <p className="mt-[2vw] flex items-center gap-[0.8vw] text-[1.8vw] text-white/80">
                <Users className="size-[2vw]" aria-hidden />
                <span data-testid="projector-player-count">{s.playerCount}</span> {s.playerCount === 1 ? "player" : "players"} joined
              </p>
              <ul className="mt-[1.5vw] flex max-h-[40vh] flex-wrap content-start gap-[0.6vw] overflow-hidden">
                {(state.players ?? []).map((p) => (
                  <li key={p.participantId} className="animate-pop rounded-full bg-white/10 px-[1.1vw] py-[0.45vw] text-[1.4vw] font-medium">
                    {p.displayName}
                  </li>
                ))}
              </ul>
              <p className="mt-[2vw] text-[1.3vw] text-white/50">The game will start when the host is ready.</p>
            </div>
          </div>
        )}

        {effective === "countdown" && (
          <div className="m-auto flex flex-col items-center text-center">
            <p className="text-[2vw] font-semibold uppercase tracking-[0.25em] text-white/60">
              Question {(s.currentPosition ?? 0) + 1} of {s.questionCount}
            </p>
            <p className="mt-[2vw] text-[14vw] font-bold leading-none tabular-nums" aria-live="polite">
              {remaining === null ? "" : Math.max(1, Math.ceil(remaining / 1000))}
            </p>
            <p className="mt-[2vw] text-[1.8vw] text-white/60">{isMc ? "Get your answer buttons ready" : "Get ready to buzz"}</p>
          </div>
        )}

        {(effective === "question_open" || effective === "reveal") && q?.prompt !== undefined && q?.choices && (
          <div className="flex flex-1 gap-[3vw]">
            <div className="flex-1">
              <QuestionStage
                prompt={q.prompt ?? ""}
                choices={q.choices}
                mode={s.mode}
                correctIndex={effective === "reveal" ? q.correctIndex : null}
                distribution={effective === "reveal" && isMc ? q.distribution : null}
                winner={effective === "reveal" ? q.winner : null}
              />
            </div>
            <aside className="flex w-[13vw] flex-col items-center justify-start gap-[2vw] pt-[1vw]">
              {(isMc || q.deadline) && effective === "question_open" && (
                <CountdownRing remainingMs={remaining} totalMs={totalMs} className="size-[11vw] text-[4vw]" />
              )}
              {isMc ? (
                <div className="text-center">
                  <p className="text-[4vw] font-bold tabular-nums" data-testid="projector-answer-count">
                    {q.answerCount ?? 0}
                  </p>
                  <p className="text-[1.2vw] text-white/60">of {s.playerCount} answered</p>
                </div>
              ) : effective === "question_open" ? (
                <div className="mt-[2vw] grid grid-cols-2 gap-[0.6vw]" aria-hidden>
                  {ANSWER_COLORS.map((c) => (
                    <span key={c.label} className="grid size-[5vw] place-items-center rounded-[0.8vw] text-[2vw] font-bold" style={{ background: c.bg }}>
                      {c.label}
                    </span>
                  ))}
                  <p className="col-span-2 mt-[0.6vw] text-center text-[1.2vw] text-white/60">Buzz on your phone</p>
                </div>
              ) : null}
            </aside>
          </div>
        )}

        {effective === "reveal" && !isMc && q && (
          <div className="mt-[2vw] animate-rise text-center text-[2.4vw] font-semibold">
            {q.winner ? (
              <span className="inline-flex items-center gap-[1vw] rounded-full bg-white/10 px-[2vw] py-[0.8vw]">
                <Crown className="size-[2.4vw] text-amber-400" aria-hidden />
                {q.winner.displayName} got it first!
              </span>
            ) : (
              <span className="text-white/70">{q.closeReason === "all_wrong" ? "Nobody got it this time." : "No winner this time."}</span>
            )}
          </div>
        )}

        {effective === "leaderboard" && (
          <div className="mx-auto flex w-full max-w-[60vw] flex-1 flex-col justify-center">
            <h2 className="mb-[2vw] text-center text-[3vw] font-semibold">Leaderboard</h2>
            <div className="text-[2vw]">
              <Leaderboard rows={state.leaderboard ?? []} />
            </div>
          </div>
        )}

        {s.status === "finished" && <FinalScreen state={state} />}

        {s.status === "aborted" && (
          <div className="m-auto text-center">
            <p className="text-[3vw] font-semibold">This game was cancelled.</p>
          </div>
        )}

        {audio.needsClick && s.status !== "aborted" && (
          <button
            onClick={() => void audio.enable()}
            className="absolute bottom-[2vw] left-[3vw] z-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[max(14px,1vw)] font-medium text-white/80 backdrop-blur hover:bg-white/20"
          >
            <Volume2 className="size-4" aria-hidden /> Click to turn on music
          </button>
        )}

        {s.status === "paused" && (
          <div className="absolute inset-0 grid place-items-center bg-stage/80 backdrop-blur-sm">
            <div className="flex items-center gap-[1.2vw] text-[3vw] font-semibold">
              <Pause className="size-[3vw]" aria-hidden /> Paused
            </div>
          </div>
        )}
      </main>
    </Stage>
  );
}

function FinalScreen({ state }: { state: ProjectorState }) {
  const standings = state.results?.standings ?? [];
  const top = winners(standings);
  return (
    <div className="m-auto flex w-full max-w-[70vw] flex-col items-center">
      <Trophy className="size-[6vw] text-amber-400" aria-hidden />
      <p className="mt-[1vw] text-[1.6vw] font-semibold uppercase tracking-[0.25em] text-white/60">Final results</p>
      <h2 className="mt-[1vw] animate-rise text-center text-[4.5vw] font-bold leading-tight">
        {top.length === 0 ? "No winner this time" : top.length === 1 ? `${top[0]!.displayName} wins!` : `It's a tie: ${top.map((t) => t.displayName).join(" & ")}`}
      </h2>
      {top.length > 0 && <p className="mt-[0.5vw] text-[1.8vw] text-white/70">{top[0]!.score} {top[0]!.score === 1 ? "point" : "points"}</p>}
      <div className="mt-[3vw] w-full max-w-[50vw] text-[1.8vw]">
        <Leaderboard rows={standings} />
      </div>
    </div>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex h-dvh w-full flex-col overflow-hidden bg-stage text-white")} style={{ backgroundImage: "radial-gradient(ellipse at top, #1a2346 0%, #0b1020 60%)" }}>
      {children}
      <span className="sr-only">{brand.productName} projector display</span>
    </div>
  );
}
