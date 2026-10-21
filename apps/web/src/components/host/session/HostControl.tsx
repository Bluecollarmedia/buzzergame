"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, Copy, Crown, ExternalLink, Flag, Pause, Play, RotateCcw, SkipForward, Square, UserX, Volume2, VolumeX, X,
} from "lucide-react";
import {
  ANSWER_COLORS, GAME_MODE_INFO, STATUS_LABELS, allowedHostCommands, buildJoinUrl, buildProjectorUrl, errorMessage,
  formatRoomCode, type HostCommand, type HostState,
} from "@crowdquiz/shared";
import { useApi } from "@/lib/useApi";
import { getSupabase } from "@/lib/supabase/client";
import { siteBaseUrl } from "@/lib/env";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Alert, Badge, Card, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { ConnectionBadge } from "@/components/game/ConnectionBadge";
import { CountdownRing } from "@/components/game/CountdownRing";
import { Leaderboard } from "@/components/game/Leaderboard";
import { QrCode } from "@/components/game/QrCode";
import { useCountdown } from "@/components/game/useCountdown";
import { useSessionSync } from "@/components/game/useSessionSync";
import { LaunchDialog } from "../LaunchDialog";

export function HostControl({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const toast = useToast();
  const fetchState = useCallback(() => api.hostState(sessionId), [api, sessionId]);
  const { state, connection, fatal, clock, refresh } = useSessionSync<HostState>({
    sessionId,
    fetchState,
    events: ["state", "roster", "answers"],
    heartbeatMs: 10000,
  });
  const [pending, setPending] = useState<HostCommand | null>(null);
  const [confirm, setConfirm] = useState<null | "end" | "skip" | "replay" | { remove: string; name: string }>(null);
  const [again, setAgain] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);

  const s = state?.session;
  const q = state?.question;
  const deadline = s?.status === "question_open" ? q?.deadline : s?.status === "countdown" || s?.status === "reveal" || s?.status === "leaderboard" ? s.phaseEndsAt : null;
  const remaining = useCountdown(clock, deadline, s?.status === "paused" ? s.pausedRemainingMs : undefined);

  const base = siteBaseUrl();
  const joinUrl = state ? buildJoinUrl(base, state.join.joinToken) : "";
  const projectorUrl = state ? buildProjectorUrl(base, state.join.projectorToken) : "";

  const run = async (cmd: HostCommand, args: Record<string, unknown> = {}) => {
    if (!s) return;
    setPending(cmd);
    try {
      const r = await api.hostCommand(sessionId, cmd, cmd === "remove_player" ? null : s.stateVersion, args);
      if (!r.applied) toast("error", "The game moved on before that took effect. Check the screen and try again.");
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setPending(null);
      setConfirm(null);
      void refresh();
    }
  };

  const connectedIds = useMemo(() => {
    if (!state || !clock) return new Set<string>();
    const now = clock.serverNow();
    return new Set(state.players.filter((p) => now - Date.parse(p.lastSeenAt) < 45000).map((p) => p.participantId));
  }, [state, clock]);

  if (fatal) {
    return (
      <div className="space-y-3">
        <Alert>{fatal.message}</Alert>
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!state || !s) return <PageSpinner label="Connecting to the game" />;

  const allowed = new Set(allowedHostCommands(s.status, { allowReplay: s.settings.allowReplay }));
  const isMc = s.mode === "multiple_choice";
  const effective = s.status === "paused" ? s.pausedFrom : s.status;
  const totalMs =
    effective === "question_open" && q?.deadline && q.startedAt ? Date.parse(q.deadline) - Date.parse(q.startedAt) : (s.settings.countdownSeconds ?? 3) * 1000;
  const ended = s.status === "finished" || s.status === "aborted";

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{s.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Badge tone={s.status === "question_open" ? "success" : s.status === "paused" ? "warning" : "neutral"}>{STATUS_LABELS[s.status]}</Badge>
            <span>{GAME_MODE_INFO[s.mode].name}</span>
            {s.currentPosition !== null && (
              <span>
                · Question {s.currentPosition + 1} of {s.questionCount}
              </span>
            )}
            <span>· {plural(s.playerCount, "player")}</span>
            <ConnectionBadge status={connection} />
          </div>
        </div>
        {!ended && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Copy className="size-4" aria-hidden />}
              onClick={async () => {
                await navigator.clipboard.writeText(joinUrl).catch(() => {});
                toast("success", "Join link copied");
              }}
            >
              Copy join link
            </Button>
            <Button
              variant="secondary"
              icon={s.settings.soundOn === false ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              loading={soundBusy}
              aria-pressed={s.settings.soundOn !== false}
              onClick={async () => {
                setSoundBusy(true);
                try {
                  await api.setProjectorSound(sessionId, s.settings.soundOn === false);
                  await refresh();
                } catch (e) {
                  toast("error", errorMessage(e));
                } finally {
                  setSoundBusy(false);
                }
              }}
            >
              {s.settings.soundOn === false ? "Projector music off" : "Projector music on"}
            </Button>
            <Button
              icon={<ExternalLink className="size-4" aria-hidden />}
              onClick={() => window.open(projectorUrl, "crowdquiz-projector", "noopener")}
            >
              Open projector
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Main panel */}
        <Card className="p-5">
          {s.status === "lobby" && (
            <div className="grid gap-6 md:grid-cols-[200px_1fr]">
              <div className="text-center">
                <QrCode value={joinUrl} className="mx-auto w-48 [&>svg]:h-auto [&>svg]:w-full" />
                <p className="mt-2 text-xs text-ink-subtle">Room code</p>
                <p className="font-mono text-2xl font-bold tracking-widest" data-testid="room-code">
                  {formatRoomCode(state.join.roomCode)}
                </p>
              </div>
              <div>
                <h2 className="font-semibold">Waiting for players</h2>
                <p className="text-sm text-ink-muted">Show the projector so everyone can scan the QR code. Start when you&apos;re ready.</p>
                <PlayerGrid state={state} connected={connectedIds} onRemove={(id, name) => setConfirm({ remove: id, name })} />
              </div>
            </div>
          )}

          {(effective === "countdown") && (
            <div className="flex items-center gap-5 py-6">
              <CountdownRing remainingMs={remaining} totalMs={totalMs} tone="light" className="size-20 text-2xl" />
              <div>
                <p className="text-sm text-ink-muted">Up next · Question {(s.currentPosition ?? 0) + 1}</p>
                <p className="text-lg font-semibold">{state.question?.prompt ?? state.nextQuestion?.prompt ?? ""}</p>
              </div>
            </div>
          )}

          {(effective === "question_open" || effective === "reveal" || effective === "leaderboard") && q && (
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-ink-muted">Question {q.position + 1}</p>
                  <p className="text-lg font-semibold">{q.prompt}</p>
                </div>
                {isMc || q.deadline ? (
                  <CountdownRing remainingMs={effective === "question_open" ? remaining : 0} totalMs={totalMs} tone="light" className="size-16 shrink-0 text-xl" />
                ) : null}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ANSWER_COLORS.map((c, i) => {
                  const correct = q.correctIndex === i;
                  const count = q.distribution?.[i];
                  return (
                    <div key={c.label} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", correct ? "border-green-600 bg-green-50" : "border-line")}>
                      <span className="grid size-7 place-items-center rounded-md text-xs font-bold text-white" style={{ background: c.bg }}>
                        {c.label}
                      </span>
                      <span className="flex-1 text-sm">{q.choices?.[i]}</span>
                      {count !== undefined && <span className="text-sm font-semibold tabular-nums">{count}</span>}
                      {correct && <Check className="size-4 text-green-700" aria-label="Correct answer" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                {isMc ? (
                  <span className="font-medium" data-testid="answer-count">
                    {q.answerCount ?? 0} of {s.playerCount} answered
                  </span>
                ) : q.winner ? (
                  <span className="inline-flex items-center gap-1 font-medium text-green-700">
                    <Crown className="size-4" aria-hidden /> {q.winner.displayName} won with {ANSWER_COLORS[q.winner.choiceIndex]!.name}
                  </span>
                ) : q.roundStatus === "closed" ? (
                  <span className="text-ink-muted">No winner this time</span>
                ) : (
                  <span className="text-ink-muted">Waiting for the first correct buzz…</span>
                )}
              </div>
              {!isMc && state.attempts.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">Buzzes</h3>
                  <ol className="space-y-1 text-sm">
                    {state.attempts.map((a, i) => (
                      <li key={`${a.participantId}-${a.attemptNo}`} className="flex items-center gap-2">
                        <span className="w-5 text-ink-subtle">{i + 1}</span>
                        <span className="size-3 rounded-full" style={{ background: ANSWER_COLORS[a.choiceIndex]!.bg }} aria-hidden />
                        <span className="flex-1">{a.displayName}</span>
                        {a.isCorrect ? <Check className="size-4 text-green-700" aria-label="Correct" /> : <X className="size-4 text-danger" aria-label="Wrong" />}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {s.status === "paused" && (
            <Alert tone="warning" className="mt-4">
              The game is paused. Players can&apos;t answer until you resume.
            </Alert>
          )}

          {ended && (
            <div>
              <h2 className="text-lg font-semibold">{s.status === "finished" ? "Final standings" : "Game cancelled"}</h2>
              {s.status === "finished" && (
                <div className="mt-4 text-base">
                  <Leaderboard rows={state.results?.standings ?? state.leaderboard} variant="light" limit={20} />
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                {s.status === "finished" && (
                  <Link href={`/sessions/${sessionId}/results`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium hover:bg-surface-muted">
                    View full results
                  </Link>
                )}
                <Button onClick={() => setAgain(true)} icon={<RotateCcw className="size-4" aria-hidden />}>
                  Play again
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Side panel */}
        <div className="space-y-5">
          {!ended && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Controls</h2>
              <div className="grid grid-cols-2 gap-2">
                {allowed.has("start") && (
                  <Button className="col-span-2" size="lg" onClick={() => run("start")} loading={pending === "start"} disabled={s.playerCount === 0} icon={<Play className="size-4" aria-hidden />}>
                    Start game
                  </Button>
                )}
                {allowed.has("resume") && (
                  <Button className="col-span-2" size="lg" onClick={() => run("resume")} loading={pending === "resume"} icon={<Play className="size-4" aria-hidden />}>
                    Resume
                  </Button>
                )}
                {allowed.has("next") && (
                  <Button className="col-span-2" onClick={() => run("next")} loading={pending === "next"} icon={<ArrowRight className="size-4" aria-hidden />}>
                    {s.status === "countdown" ? "Start question now" : s.currentPosition !== null && s.currentPosition + 1 >= s.questionCount && s.status === "reveal" ? "Show final results" : "Next"}
                  </Button>
                )}
                {allowed.has("close_question") && (
                  <Button variant="secondary" className="col-span-2" onClick={() => run("close_question")} loading={pending === "close_question"} icon={<Square className="size-4" aria-hidden />}>
                    {isMc ? "End question now" : "End with no winner"}
                  </Button>
                )}
                {allowed.has("pause") && (
                  <Button variant="secondary" onClick={() => run("pause")} loading={pending === "pause"} icon={<Pause className="size-4" aria-hidden />}>
                    Pause
                  </Button>
                )}
                {allowed.has("skip") && (
                  <Button variant="secondary" onClick={() => setConfirm("skip")} icon={<SkipForward className="size-4" aria-hidden />}>
                    Skip
                  </Button>
                )}
                {allowed.has("replay") && (
                  <Button variant="secondary" onClick={() => setConfirm("replay")} icon={<RotateCcw className="size-4" aria-hidden />}>
                    Replay
                  </Button>
                )}
                {allowed.has("end") && (
                  <Button variant="ghost" className="col-span-2 text-danger hover:text-danger" onClick={() => setConfirm("end")} icon={<Flag className="size-4" aria-hidden />}>
                    End game
                  </Button>
                )}
              </div>
              {s.status !== "lobby" && !s.settings.autoAdvance && (s.status === "reveal" || s.status === "leaderboard") && (
                <p className="mt-3 text-xs text-ink-subtle">Automatic progression is off. Press Next to continue.</p>
              )}
            </Card>
          )}

          {s.status !== "lobby" && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Scores</h2>
              <div className="max-h-80 overflow-y-auto text-sm">
                <Leaderboard rows={state.leaderboard} variant="light" limit={100} />
              </div>
            </Card>
          )}

          {s.status !== "lobby" && !ended && (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">Players</h2>
              <p className="mb-2 text-xs text-ink-subtle">
                {connectedIds.size} of {state.players.length} recently connected
              </p>
              <PlayerGrid state={state} connected={connectedIds} compact onRemove={(id, name) => setConfirm({ remove: id, name })} />
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "end"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run("end")}
        loading={pending === "end"}
        destructive
        title={s.status === "lobby" ? "Cancel this game?" : "End the game now?"}
        confirmLabel={s.status === "lobby" ? "Cancel game" : "End game"}
        body={s.status === "lobby" ? "Players in the lobby will see that the game was cancelled." : "Scores so far become the final results. Any open question is discarded."}
      />
      <ConfirmDialog
        open={confirm === "skip"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run("skip")}
        loading={pending === "skip"}
        title="Skip ahead?"
        confirmLabel="Skip"
        body={s.status === "question_open" ? "This question will be discarded without awarding points." : "Move straight to the next question."}
      />
      <ConfirmDialog
        open={confirm === "replay"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run("replay")}
        loading={pending === "replay"}
        title="Replay this question?"
        confirmLabel="Replay"
        body="Points from the previous attempt at this question are removed, and everyone answers again."
      />
      <ConfirmDialog
        open={typeof confirm === "object" && confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => typeof confirm === "object" && confirm && run("remove_player", { participantId: confirm.remove })}
        loading={pending === "remove_player"}
        destructive
        title="Remove player?"
        confirmLabel="Remove"
        body={<>Remove <strong>{typeof confirm === "object" && confirm ? confirm.name : ""}</strong> from this game? They won&apos;t be able to rejoin.</>}
      />
      {again && <AgainDialog sessionId={sessionId} onClose={() => setAgain(false)} />}
    </div>
  );
}

function PlayerGrid({
  state,
  connected,
  compact,
  onRemove,
}: {
  state: HostState;
  connected: Set<string>;
  compact?: boolean;
  onRemove: (id: string, name: string) => void;
}) {
  if (state.players.length === 0) {
    return <p className="mt-4 rounded-lg bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted">No players yet.</p>;
  }
  return (
    <ul className={cn("mt-3 flex flex-wrap gap-1.5", compact && "max-h-56 overflow-y-auto")} data-testid="player-list">
      {state.players.map((p) => (
        <li key={p.participantId} className="group inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pl-2.5 pr-1 text-sm">
          <span className={cn("size-1.5 rounded-full", connected.has(p.participantId) ? "bg-green-500" : "bg-slate-300")} aria-hidden />
          {p.displayName}
          <button onClick={() => onRemove(p.participantId, p.displayName)} className="rounded-full p-0.5 text-ink-subtle hover:bg-slate-200 hover:text-danger" aria-label={`Remove ${p.displayName}`}>
            <UserX className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Start a fresh session (new scores) from the same quiz. */
function AgainDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const api = useApi();
  const [quiz, setQuiz] = useState<{ id: string; title: string; mode: HostState["session"]["mode"]; settings: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.sessionResults(sessionId);
        if (!res.session.quizId) return setError("The original quiz was deleted, so it can't be played again.");
        const { data } = await getSupabase().from("quizzes").select("id, title, mode, settings").eq("id", res.session.quizId).maybeSingle();
        if (!data) return setError("The original quiz was deleted, so it can't be played again.");
        setQuiz(data as typeof quiz);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [api, sessionId]);
  if (error) {
    return (
      <ConfirmDialog open onCancel={onClose} onConfirm={onClose} title="Can't play again" confirmLabel="OK" body={error} />
    );
  }
  if (!quiz) return null;
  return <LaunchDialog quiz={quiz} onClose={onClose} />;
}
