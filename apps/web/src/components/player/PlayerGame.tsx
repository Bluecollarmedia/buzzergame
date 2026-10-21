"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, Crown, Lock, Pause, Trophy, X } from "lucide-react";
import {
  ANSWER_COLORS, createGameApi, errorMessage, toAppError, uuidv4, type PlayerState, type SubmitResult,
} from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/components/ui/cn";
import { ConnectionBadge } from "@/components/game/ConnectionBadge";
import { useCountdown } from "@/components/game/useCountdown";
import { useSessionSync } from "@/components/game/useSessionSync";

type Pending = { roundId: string; choice: number; submissionId: string } | null;

/** The phone controller. Never shows the question text. */
export function PlayerGame({ sessionId, secret, onLeave }: { sessionId: string; secret: string; onLeave: () => void }) {
  const [api] = useState(() => createGameApi(getSupabase()));
  const fetchState = useCallback(() => api.playerState(sessionId, secret), [api, sessionId, secret]);
  const { state, connection, clock, fatal, refresh } = useSessionSync<PlayerState>({
    sessionId,
    fetchState,
    events: ["state", "roster"],
    heartbeatMs: 15000,
  });
  const [pendingRaw, setPending] = useState<Pending>(null);
  const [lastResult, setLastResult] = useState<{ roundId: string; result: SubmitResult["result"] } | null>(null);
  const [notice, setNotice] = useState<{ roundId: string | null; text: string } | null>(null);
  const submittingRef = useRef(false);

  useWakeLock();

  const s = state?.session;
  const q = state?.question;
  const roundId = q?.roundId ?? null;
  const deadline = s?.status === "question_open" ? q?.deadline : s?.status === "countdown" ? s.phaseEndsAt : null;
  const remaining = useCountdown(clock, deadline, s?.status === "paused" ? s.pausedRemainingMs : undefined);
  // Per-question UI only applies to the round it was created for.
  const pending = pendingRaw && pendingRaw.roundId === roundId ? pendingRaw : null;


  const submit = async (choice: number) => {
    if (!s || !roundId || submittingRef.current) return;
    submittingRef.current = true;
    // Reuse the submission id when retrying the same tap after a network error.
    const submissionId = pending && pending.roundId === roundId && pending.choice === choice ? pending.submissionId : uuidv4();
    setPending({ roundId, choice, submissionId });
    setNotice(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api.submitAnswer(sessionId, secret, roundId, choice, submissionId);
        setLastResult({ roundId, result: r.result });
        break;
      } catch (e) {
        const err = toAppError(e);
        if (err.code === "network" && attempt < 2) {
          await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
          continue;
        }
        setNotice({ roundId, text: errorMessage(e) });
        break;
      }
    }
    submittingRef.current = false;
    setPending(null);
    void refresh();
  };

  if (fatal) {
    return (
      <Shell>
        <div className="m-auto max-w-xs text-center">
          <p className="text-xl font-semibold">{fatal.message}</p>
          <button onClick={onLeave} className="mt-6 rounded-xl bg-white/10 px-5 py-3 font-medium">
            Back
          </button>
        </div>
      </Shell>
    );
  }
  if (!state || !s) {
    return (
      <Shell>
        <p className="m-auto text-white/60" role="status">
          Connecting…
        </p>
      </Shell>
    );
  }

  const effective = s.status === "paused" ? s.pausedFrom : s.status;
  const isMc = s.mode === "multiple_choice";
  const myAnswers = state.myAnswers;
  const lastAnswer = myAnswers[myAnswers.length - 1];
  const timeUp = isMc && remaining !== null && remaining <= 0;
  const lockedOut = !isMc && s.settings.buzzerLockout !== false && myAnswers.length > 0;
  const answered = isMc && myAnswers.length > 0;
  const canChange = isMc && s.settings.allowAnswerChange === true;
  const buttonsEnabled =
    s.status === "question_open" && !!roundId && !timeUp && !pending && !lockedOut && (!answered || canChange) && q?.roundStatus === "open";

  return (
    <Shell>
      <header className="flex items-center justify-between px-4 pt-3 text-sm">
        <span className="max-w-[55%] truncate font-medium text-white/80">{state.me.displayName}</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums" aria-label="Your score">
            {state.me.score} pts
          </span>
          {connection !== "live" && <ConnectionBadge status={connection} tone="stage" />}
        </div>
      </header>

      {/* Countdown bar for timed questions */}
      {effective === "question_open" && q?.deadline && q.startedAt && (
        <TimerBar remaining={remaining} total={Date.parse(q.deadline) - Date.parse(q.startedAt)} />
      )}

      <main className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {s.status === "lobby" && (
          <Center>
            <Check className="size-12 text-green-400" aria-hidden />
            <p className="mt-4 text-2xl font-semibold">You&apos;re in!</p>
            <p className="mt-1 text-white/60">Look at the big screen. The game will start soon.</p>
            <p className="mt-6 text-sm text-white/40">
              {s.playerCount} {s.playerCount === 1 ? "player" : "players"} in the lobby
            </p>
          </Center>
        )}

        {effective === "countdown" && (
          <Center>
            <p className="text-sm font-semibold uppercase tracking-widest text-white/50">
              Question {(s.currentPosition ?? 0) + 1} of {s.questionCount}
            </p>
            <p className="mt-4 text-8xl font-bold tabular-nums">{remaining === null ? "" : Math.max(1, Math.ceil(remaining / 1000))}</p>
            <p className="mt-4 text-white/60">Watch the screen for the question</p>
          </Center>
        )}

        {effective === "question_open" && (
          <div className="flex flex-1 flex-col">
            <StatusLine
              text={
                pending
                  ? isMc
                    ? "Sending…"
                    : "Checking…"
                  : notice?.roundId === roundId && notice
                    ? notice.text
                    : timeUp
                      ? "Time's up"
                      : lockedOut
                        ? lastAnswer?.isCorrect === false
                          ? "Not quite. You're out for this question."
                          : "Answer sent"
                        : answered
                          ? canChange
                            ? `Answer ${ANSWER_COLORS[lastAnswer!.choiceIndex]!.label} locked in. Tap another to change.`
                            : `Answer ${ANSWER_COLORS[lastAnswer!.choiceIndex]!.label} locked in`
                          : isMc
                            ? "Choose your answer"
                            : "Press the colour of the right answer"
              }
              tone={notice?.roundId === roundId && notice ? "warn" : lockedOut && lastAnswer?.isCorrect === false ? "bad" : "neutral"}
            />
            <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3" role="group" aria-label="Answers">
              {ANSWER_COLORS.map((c, i) => {
                const chosen = (pending?.choice ?? lastAnswer?.choiceIndex) === i && (pending || myAnswers.length > 0);
                const text = q?.choices?.[i];
                return (
                  <button
                    key={c.label}
                    onClick={() => submit(i)}
                    disabled={!buttonsEnabled}
                    aria-pressed={chosen ? true : undefined}
                    aria-label={`${c.name} ${c.label}${text ? `: ${text}` : ""}`}
                    className={cn(
                      "relative flex min-h-24 flex-col items-center justify-center rounded-2xl px-3 text-white shadow-lg transition-[transform,opacity] duration-100 active:scale-[0.97] disabled:active:scale-100",
                      !buttonsEnabled && !chosen && "opacity-40",
                      chosen && "ring-4 ring-white",
                    )}
                    style={{ background: chosen ? c.bgPressed : c.bg }}
                  >
                    <span className="text-5xl font-bold leading-none">{c.label}</span>
                    {text && <span className="mt-2 line-clamp-3 text-center text-base font-medium leading-snug">{text}</span>}
                    {!isMc && <span className="mt-1 text-sm font-medium text-white/80">{c.name}</span>}
                    {chosen && !pending && (
                      <span className="absolute right-3 top-3 rounded-full bg-white/25 p-1">
                        {lastAnswer?.isCorrect === false ? <X className="size-4" aria-hidden /> : lastAnswer?.isCorrect === true ? <Check className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {effective === "reveal" && q && <Reveal state={state} lastResult={lastResult} />}

        {effective === "leaderboard" && (
          <Center>
            <Trophy className="size-10 text-amber-400" aria-hidden />
            <p className="mt-3 text-white/60">Your position</p>
            <p className="text-6xl font-bold tabular-nums">{state.me.rank ?? "–"}</p>
            <p className="mt-2 text-lg">{state.me.score} points</p>
            <MiniBoard state={state} />
          </Center>
        )}

        {s.status === "finished" && (
          <Center>
            <Trophy className={cn("size-14", state.me.rank === 1 && state.me.score > 0 ? "text-amber-400" : "text-white/40")} aria-hidden />
            <p className="mt-3 text-sm uppercase tracking-widest text-white/50">Game over</p>
            <p className="mt-2 text-3xl font-bold">
              {state.me.rank === 1 && state.me.score > 0 ? "You won!" : state.me.rank ? `You finished #${state.me.rank}` : "Thanks for playing"}
            </p>
            <p className="mt-1 text-lg text-white/80">
              {state.me.score} points · {state.me.correctCount} correct
            </p>
            <MiniBoard state={state} />
          </Center>
        )}

        {s.status === "aborted" && (
          <Center>
            <p className="text-2xl font-semibold">The host cancelled this game.</p>
          </Center>
        )}

        {s.status === "paused" && (
          <div className="fixed inset-0 z-10 grid place-items-center bg-stage/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Pause className="size-10" aria-hidden />
              <p className="text-xl font-semibold">Paused</p>
              <p className="text-sm text-white/60">The host will resume shortly.</p>
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}

function Reveal({ state, lastResult }: { state: PlayerState; lastResult: { roundId: string; result: string } | null }) {
  const q = state.question!;
  const isMc = state.session.mode === "multiple_choice";
  const mine = state.myAnswers[state.myAnswers.length - 1];
  const correct = q.correctIndex !== null && q.correctIndex !== undefined ? ANSWER_COLORS[q.correctIndex] : null;
  if (isMc) {
    const right = mine?.isCorrect === true;
    return (
      <Center>
        <div className={cn("grid size-20 place-items-center rounded-full", !mine ? "bg-white/10" : right ? "bg-green-500" : "bg-red-500")}>
          {!mine ? <Clock className="size-10" aria-hidden /> : right ? <Check className="size-10" aria-hidden /> : <X className="size-10" aria-hidden />}
        </div>
        <p className="mt-4 text-3xl font-bold">{!mine ? "No answer" : right ? "Correct!" : "Not this time"}</p>
        {state.myRoundPoints ? <p className="mt-1 text-lg text-green-300">+{state.myRoundPoints} points</p> : null}
        {correct && (
          <p className="mt-4 flex items-center gap-2 text-white/70">
            The answer was
            <span className="rounded-md px-2 py-0.5 font-bold text-white" style={{ background: correct.bg }}>
              {correct.label}
            </span>
          </p>
        )}
      </Center>
    );
  }
  const iWon = q.winner?.participantId === state.me.participantId || (lastResult?.roundId === q.roundId && lastResult?.result === "won");
  return (
    <Center>
      {iWon ? (
        <>
          <Crown className="size-14 text-amber-400" aria-hidden />
          <p className="mt-3 text-3xl font-bold">You got it first!</p>
          {state.myRoundPoints ? <p className="mt-1 text-lg text-green-300">+{state.myRoundPoints} points</p> : null}
        </>
      ) : q.winner ? (
        <>
          <Lock className="size-12 text-white/50" aria-hidden />
          <p className="mt-3 text-2xl font-semibold">{q.winner.displayName} got it first</p>
        </>
      ) : (
        <p className="text-2xl font-semibold">No winner this time</p>
      )}
      {correct && (
        <p className="mt-4 flex items-center gap-2 text-white/70">
          The answer was
          <span className="rounded-md px-2 py-0.5 font-bold text-white" style={{ background: correct.bg }}>
            {correct.name} {correct.label}
          </span>
        </p>
      )}
    </Center>
  );
}

function MiniBoard({ state }: { state: PlayerState }) {
  if (!state.leaderboard || state.leaderboard.length === 0) return null;
  return (
    <ol className="mt-6 w-full max-w-xs space-y-1.5 text-left text-sm">
      {state.leaderboard.slice(0, 5).map((r) => (
        <li key={r.participantId} className={cn("flex items-center gap-2 rounded-lg px-3 py-2", r.participantId === state.me.participantId ? "bg-white/20" : "bg-white/5")}>
          <span className="w-5 font-semibold text-white/60">{r.rank}</span>
          <span className="flex-1 truncate">{r.displayName}</span>
          <span className="font-semibold tabular-nums">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusLine({ text, tone }: { text: string; tone: "neutral" | "good" | "bad" | "warn" }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "mb-3 rounded-xl px-4 py-3 text-center text-base font-medium",
        tone === "good" && "bg-green-500/15 text-green-200",
        tone === "bad" && "bg-red-500/15 text-red-200",
        tone === "warn" && "bg-amber-500/15 text-amber-200",
        tone === "neutral" && "bg-white/5 text-white/80",
      )}
    >
      {text}
    </p>
  );
}

function TimerBar({ remaining, total }: { remaining: number | null; total: number }) {
  const frac = remaining === null || total <= 0 ? 0 : Math.max(0, Math.min(1, remaining / total));
  const secs = remaining === null ? null : Math.ceil(remaining / 1000);
  return (
    <div className="mx-4 mt-3 flex items-center gap-3" role="timer" aria-label={secs === null ? "" : `${secs} seconds left`}>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full transition-[width] duration-100 ease-linear", secs !== null && secs <= 5 ? "bg-red-500" : "bg-white")} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className={cn("w-8 text-right font-bold tabular-nums", secs !== null && secs <= 5 && "text-red-400")}>{secs ?? ""}</span>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="m-auto flex w-full animate-fade-in flex-col items-center text-center">{children}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh select-none flex-col overflow-hidden bg-stage text-white [touch-action:manipulation]">{children}</div>;
}

/** Keep the phone screen awake during the game where supported. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => {
      if (document.visibilityState === "visible" && nav.wakeLock) {
        nav.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}
