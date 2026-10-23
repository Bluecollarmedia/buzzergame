import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { Crown, Pause, Trophy, WifiOff } from "lucide-react-native";
import { errorMessage, toAppError, uuidv4, type PlayerState, type SubmitResult } from "@crowdquiz/shared";
import { AnswerButton, PopNumber, ResultBadge, TimerRing, UrgencyGlow } from "./game";
import { Glass } from "./glass";
import { Button, Center, PulseDot, Screen, styles as ui } from "./ui";
import { getApi } from "@/lib/supabase";
import { feel, useQuestionHaptics, useReadyHaptics } from "@/lib/haptics";
import { useCountdown, useSessionSync } from "@/lib/useSessionSync";
import { ANSWER_COLORS, colors, radius, space } from "@/lib/theme";

type Pending = { roundId: string; choice: number; submissionId: string } | null;

/**
 * The phone controller. Shows the coloured answer buttons and personal
 * feedback; the question itself is only on the big screen.
 */
export function PlayerGame({ sessionId, secret, onLeave }: { sessionId: string; secret: string; onLeave: () => void }) {
  useKeepAwake();
  const fetchState = useCallback(() => getApi().playerState(sessionId, secret), [sessionId, secret]);
  const { state, connection, clock, fatal, refresh } = useSessionSync<PlayerState>({ sessionId, fetchState, heartbeatMs: 15000 });
  const [pendingRaw, setPending] = useState<Pending>(null);
  const [lastResult, setLastResult] = useState<{ roundId: string; result: SubmitResult["result"] } | null>(null);
  const [notice, setNotice] = useState<{ roundId: string | null; text: string } | null>(null);
  const submitting = useRef(false);

  const s = state?.session;
  const q = state?.question;
  const roundId = q?.roundId ?? null;
  const deadline = s?.status === "question_open" ? q?.deadline : s?.status === "countdown" ? s.phaseEndsAt : null;
  const remaining = useCountdown(clock, deadline, s?.status === "paused" ? s.pausedRemainingMs : undefined);
  const pending = pendingRaw && pendingRaw.roundId === roundId ? pendingRaw : null;
  const totalMs = q?.deadline && q.startedAt ? Date.parse(q.deadline) - Date.parse(q.startedAt) : 0;
  const questionOpen = s?.status === "question_open" && !!q?.deadline;

  // Anticipation: the 3-2-1 before a question, then the buzz that builds as time runs out.
  useReadyHaptics({ active: s?.status === "countdown", remainingMs: s?.status === "countdown" ? remaining : null, roundKey: `c${s?.currentPosition}` });
  useQuestionHaptics({ active: questionOpen, remainingMs: questionOpen ? remaining : null, totalMs, roundKey: roundId });

  // A short "go" when the question opens, and a "joined" feel in the lobby.
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!s) return;
    if (prevStatus.current === "countdown" && s.status === "question_open") feel.go();
    if (prevStatus.current === null && s.status === "lobby") feel.joined();
    prevStatus.current = s.status;
  }, [s]);

  const submit = async (choice: number) => {
    if (!s || !roundId || submitting.current) return;
    submitting.current = true;
    feel.press();
    const submissionId = pending && pending.choice === choice ? pending.submissionId : uuidv4();
    setPending({ roundId, choice, submissionId });
    setNotice(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await getApi().submitAnswer(sessionId, secret, roundId, choice, submissionId);
        setLastResult({ roundId, result: r.result });
        if (r.result === "won") feel.win();
        if (r.result === "wrong") feel.wrong();
        break;
      } catch (e) {
        if (toAppError(e).code === "network" && attempt < 2) {
          await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
          continue;
        }
        setNotice({ roundId, text: errorMessage(e) });
        break;
      }
    }
    submitting.current = false;
    setPending(null);
    void refresh();
  };

  // Tell the player how their multiple-choice answer did when the question closes.
  const revealFor = useRef<string | null>(null);
  const isReveal = s?.status === "reveal" || (s?.status === "paused" && s.pausedFrom === "reveal");
  useEffect(() => {
    if (!isReveal || !q?.roundId || revealFor.current === q.roundId) return;
    revealFor.current = q.roundId;
    if (s?.mode !== "multiple_choice") return;
    const mine = state?.myAnswers[state.myAnswers.length - 1];
    if (mine?.isCorrect === true) feel.right();
    else if (mine?.isCorrect === false) feel.wrong();
  }, [isReveal, q?.roundId, s?.mode, state?.myAnswers]);

  if (fatal) {
    return (
      <Screen>
        <Center>
          <Text style={ui.big}>{fatal.message}</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Back" variant="glass" onPress={onLeave} />
          </View>
        </Center>
      </Screen>
    );
  }
  if (!state || !s) {
    return (
      <Screen>
        <Center>
          <PulseDot color={colors.primary} size={14} />
          <Text style={[ui.body, { marginTop: 14 }]}>Connecting…</Text>
        </Center>
      </Screen>
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
  const enabled =
    s.status === "question_open" && !!roundId && !timeUp && !pending && !lockedOut && (!answered || canChange) && q?.roundStatus === "open";

  const statusText = pending
    ? isMc ? "Sending…" : "Checking…"
    : notice?.roundId === roundId && notice
      ? notice.text
      : timeUp
        ? "Time's up"
        : lockedOut
          ? lastAnswer?.isCorrect === false ? "Not quite. You're out for this question." : "Answer sent"
          : answered && lastAnswer
            ? `Answer ${ANSWER_COLORS[lastAnswer.choiceIndex]!.label} locked in${canChange ? ". Tap another to change." : ""}`
            : isMc ? "Choose your answer" : "Hit the colour of the right answer";
  const tone = notice?.roundId === roundId && notice ? colors.warn : lockedOut && lastAnswer?.isCorrect === false ? colors.bad : answered ? colors.text : colors.muted;

  return (
    <Screen style={{ paddingHorizontal: space.lg }}>
      {effective === "question_open" && <UrgencyGlow remainingMs={s.status === "question_open" ? remaining : null} />}

      <View style={local.header}>
        <Glass radiusSize={radius.pill} style={local.headerPill}>
          <Text style={local.headerName} numberOfLines={1}>
            {state.me.displayName}
          </Text>
        </Glass>
        <View style={ui.row}>
          {connection !== "live" && <WifiOff color={colors.warn} size={18} accessibilityLabel="Reconnecting" />}
          <Glass radiusSize={radius.pill} style={local.headerPill}>
            <Text style={local.headerScore} accessibilityLabel={`Your score ${state.me.score}`}>
              {state.me.score} pts
            </Text>
          </Glass>
        </View>
      </View>

      {s.status === "lobby" && (
        <Center>
          <PulseDot size={14} />
          <Text style={[ui.title, { marginTop: 18, textAlign: "center" }]}>You&apos;re in!</Text>
          <Text style={[ui.body, { marginTop: 8, textAlign: "center" }]}>Look at the big screen. The game starts soon.</Text>
          <Text style={[ui.small, { marginTop: 24 }]}>
            {s.playerCount} {s.playerCount === 1 ? "player" : "players"} here
          </Text>
          <View style={{ alignSelf: "stretch", marginTop: 32 }}>
            <Button title="Leave game" variant="ghost" onPress={onLeave} />
          </View>
        </Center>
      )}

      {effective === "countdown" && (
        <Center>
          <Text style={ui.label}>
            Question {(s.currentPosition ?? 0) + 1} of {s.questionCount}
          </Text>
          <PopNumber value={remaining === null ? "" : String(Math.max(1, Math.ceil(remaining / 1000)))} />
          <Text style={ui.body}>Eyes on the screen</Text>
        </Center>
      )}

      {effective === "question_open" && (
        <View style={{ flex: 1, paddingBottom: space.md }}>
          <View style={local.timerRow}>
            <TimerRing remainingMs={remaining} totalMs={totalMs} />
            <Glass radiusSize={radius.lg} style={local.statusBox}>
              <Text style={[local.status, { color: tone }]} accessibilityLiveRegion="polite" accessibilityRole="text">
                {statusText}
              </Text>
            </Glass>
          </View>
          <View style={local.grid} accessibilityLabel="Answers">
            {ANSWER_COLORS.map((c, i) => {
              const chosen = (pending?.choice ?? lastAnswer?.choiceIndex) === i && (!!pending || myAnswers.length > 0);
              return (
                <AnswerButton
                  key={c.label}
                  index={i}
                  text={q?.choices?.[i]}
                  showName={!isMc}
                  enabled={enabled}
                  chosen={chosen}
                  instant={!isMc}
                  resultIcon={chosen && !pending ? (lastAnswer?.isCorrect === false ? "wrong" : lastAnswer?.isCorrect === true ? "correct" : "locked") : null}
                  onPress={() => void submit(i)}
                />
              );
            })}
          </View>
        </View>
      )}

      {effective === "reveal" && q && <Reveal state={state} lastResult={lastResult} />}

      {effective === "leaderboard" && (
        <Center>
          <Trophy color={colors.gold} size={44} />
          <Text style={[ui.body, { marginTop: 10 }]}>Your position</Text>
          <Text style={local.rank}>{state.me.rank ?? "–"}</Text>
          <Text style={[ui.h2]}>{state.me.score} points</Text>
          <MiniBoard state={state} />
        </Center>
      )}

      {s.status === "finished" && (
        <Center>
          <ResultBadge kind={state.me.rank === 1 && state.me.score > 0 ? "trophy" : "none"} />
          <Text style={[ui.label, { marginTop: 18 }]}>Game over</Text>
          <Text style={[ui.big, { marginTop: 6 }]}>
            {state.me.rank === 1 && state.me.score > 0 ? "You won!" : state.me.rank ? `You finished #${state.me.rank}` : "Thanks for playing"}
          </Text>
          <Text style={[ui.body, { color: colors.text, marginTop: 4 }]}>
            {state.me.score} points · {state.me.correctCount} correct
          </Text>
          <MiniBoard state={state} />
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Done" variant="glass" onPress={onLeave} />
          </View>
        </Center>
      )}

      {s.status === "aborted" && (
        <Center>
          <Text style={ui.big}>The host cancelled this game.</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Back" variant="glass" onPress={onLeave} />
          </View>
        </Center>
      )}

      {s.status === "paused" && (
        <View style={local.pauseOverlay} accessibilityViewIsModal>
          <Glass radiusSize={radius.xl} style={{ padding: space.xxl, alignItems: "center", gap: 8 }}>
            <Pause color="white" size={40} />
            <Text style={[ui.big, { fontSize: 24 }]}>Paused</Text>
            <Text style={ui.body}>The host will resume shortly.</Text>
          </Glass>
        </View>
      )}
    </Screen>
  );
}

function Reveal({ state, lastResult }: { state: PlayerState; lastResult: { roundId: string; result: string } | null }) {
  const q = state.question!;
  const mine = state.myAnswers[state.myAnswers.length - 1];
  const correct = q.correctIndex !== null && q.correctIndex !== undefined ? ANSWER_COLORS[q.correctIndex] : null;
  const answerChip = correct && (
    <View style={[ui.row, { marginTop: 18 }]}>
      <Text style={ui.body}>The answer was</Text>
      <Glass tint={correct.bg} radiusSize={10} style={{ paddingHorizontal: 12, paddingVertical: 5 }}>
        <Text style={local.chipText}>{state.session.mode === "multiple_choice" ? correct.label : `${correct.name} ${correct.label}`}</Text>
      </Glass>
    </View>
  );

  if (state.session.mode === "multiple_choice") {
    const right = mine?.isCorrect === true;
    return (
      <Center>
        <ResultBadge kind={!mine ? "none" : right ? "correct" : "wrong"} />
        <Text style={[ui.big, { marginTop: 18 }]}>{!mine ? "No answer" : right ? "Correct!" : "Not this time"}</Text>
        {state.myRoundPoints ? <Text style={local.points}>+{state.myRoundPoints} points</Text> : null}
        {answerChip}
      </Center>
    );
  }

  const iWon = q.winner?.participantId === state.me.participantId || (lastResult?.roundId === q.roundId && lastResult?.result === "won");
  return (
    <Center>
      {iWon ? (
        <>
          <Crown color={colors.gold} size={72} />
          <Text style={[ui.big, { marginTop: 12 }]}>You got it first!</Text>
          {state.myRoundPoints ? <Text style={local.points}>+{state.myRoundPoints} points</Text> : null}
        </>
      ) : q.winner ? (
        <Text style={[ui.big, { fontSize: 26 }]}>{q.winner.displayName} got it first</Text>
      ) : (
        <Text style={[ui.big, { fontSize: 26 }]}>No winner this time</Text>
      )}
      {answerChip}
    </Center>
  );
}

function MiniBoard({ state }: { state: PlayerState }) {
  if (!state.leaderboard || state.leaderboard.length === 0) return null;
  return (
    <View style={{ alignSelf: "stretch", marginTop: 20, gap: 8 }}>
      {state.leaderboard.slice(0, 5).map((r) => {
        const me = r.participantId === state.me.participantId;
        return (
          <Glass key={r.participantId} tint={me ? colors.primary : undefined} radiusSize={radius.md} style={local.boardRow}>
            <Text style={[local.boardText, { width: 24, color: colors.muted }]}>{r.rank}</Text>
            <Text style={[local.boardText, { flex: 1 }]} numberOfLines={1}>
              {r.displayName}
            </Text>
            <Text style={[local.boardText, { fontWeight: "800" }]}>{r.score}</Text>
          </Glass>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  headerPill: { paddingHorizontal: 14, paddingVertical: 8, maxWidth: 220 },
  headerName: { color: colors.text, fontWeight: "700", fontSize: 15 },
  headerScore: { color: colors.text, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] },
  timerRow: { flexDirection: "row", alignItems: "center", gap: space.lg, marginBottom: space.lg },
  statusBox: { flex: 1, padding: space.md, minHeight: 64, justifyContent: "center" },
  status: { fontSize: 16, fontWeight: "700" },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: space.md },
  rank: { color: colors.text, fontSize: 80, fontWeight: "900", fontVariant: ["tabular-nums"] },
  points: { color: colors.good, fontSize: 20, fontWeight: "700", marginTop: 8 },
  chipText: { color: "white", fontWeight: "900", fontSize: 16 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  boardText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  pauseOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(8,11,24,0.82)", alignItems: "center", justifyContent: "center" },
});
