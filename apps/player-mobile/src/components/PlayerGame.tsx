import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { Check, Clock, Crown, Lock, Pause, Trophy, WifiOff, X } from "lucide-react-native";
import { errorMessage, toAppError, uuidv4, type PlayerState, type SubmitResult } from "@crowdquiz/shared";
import { Button, Center, Screen, styles } from "./ui";
import { getApi } from "@/lib/supabase";
import { useCountdown, useSessionSync } from "@/lib/useSessionSync";
import { ANSWER_COLORS, colors } from "@/lib/theme";

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

  const submit = async (choice: number) => {
    if (!s || !roundId || submitting.current) return;
    submitting.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const submissionId = pending && pending.choice === choice ? pending.submissionId : uuidv4();
    setPending({ roundId, choice, submissionId });
    setNotice(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await getApi().submitAnswer(sessionId, secret, roundId, choice, submissionId);
        setLastResult({ roundId, result: r.result });
        if (r.result === "won") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (r.result === "wrong") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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

  if (fatal) {
    return (
      <Screen>
        <Center>
          <Text style={styles.big}>{fatal.message}</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Back" variant="secondary" onPress={onLeave} />
          </View>
        </Center>
      </Screen>
    );
  }
  if (!state || !s) {
    return (
      <Screen>
        <Center>
          <Text style={styles.body}>Connecting…</Text>
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
          : answered && lastAnswer
            ? `Answer ${ANSWER_COLORS[lastAnswer.choiceIndex]!.label} locked in${canChange ? ". Tap another to change." : ""}`
            : isMc
              ? "Choose your answer"
              : "Press the colour of the right answer";
  const tone = notice?.roundId === roundId && notice ? colors.warn : lockedOut && lastAnswer?.isCorrect === false ? colors.bad : answered ? colors.good : colors.muted;

  return (
    <Screen style={{ paddingHorizontal: 16 }}>
      <View style={local.header}>
        <Text style={local.headerName} numberOfLines={1}>
          {state.me.displayName}
        </Text>
        <View style={styles.row}>
          {connection !== "live" && <WifiOff color={colors.warn} size={16} accessibilityLabel="Reconnecting" />}
          <Text style={local.headerScore} accessibilityLabel={`Your score ${state.me.score}`}>
            {state.me.score} pts
          </Text>
        </View>
      </View>

      {effective === "question_open" && q?.deadline && q.startedAt && (
        <TimerBar remaining={remaining} total={Date.parse(q.deadline) - Date.parse(q.startedAt)} />
      )}

      {s.status === "lobby" && (
        <Center>
          <Check color={colors.good} size={52} />
          <Text style={[styles.big, { marginTop: 12 }]}>You&apos;re in!</Text>
          <Text style={[styles.body, { marginTop: 6 }]}>Look at the big screen. The game will start soon.</Text>
          <Text style={[styles.body, { marginTop: 20, color: colors.subtle, fontSize: 14 }]}>
            {s.playerCount} {s.playerCount === 1 ? "player" : "players"} in the lobby
          </Text>
        </Center>
      )}

      {effective === "countdown" && (
        <Center>
          <Text style={styles.label}>
            Question {(s.currentPosition ?? 0) + 1} of {s.questionCount}
          </Text>
          <Text style={local.countdown}>{remaining === null ? "" : Math.max(1, Math.ceil(remaining / 1000))}</Text>
          <Text style={styles.body}>Watch the screen for the question</Text>
        </Center>
      )}

      {effective === "question_open" && (
        <View style={{ flex: 1, paddingBottom: 12 }}>
          <Text style={[local.status, { color: tone }]} accessibilityLiveRegion="polite" accessibilityRole="text">
            {statusText}
          </Text>
          <View style={local.grid} accessibilityLabel="Answers">
            {ANSWER_COLORS.map((c, i) => {
              const chosen = (pending?.choice ?? lastAnswer?.choiceIndex) === i && (!!pending || myAnswers.length > 0);
              const text = q?.choices?.[i];
              return (
                <Pressable
                  key={c.label}
                  onPress={() => void submit(i)}
                  disabled={!enabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name} ${c.label}${text ? `: ${text}` : ""}`}
                  accessibilityState={{ disabled: !enabled, selected: chosen }}
                  style={({ pressed }) => [
                    local.answer,
                    { backgroundColor: chosen ? c.bgPressed : c.bg },
                    !enabled && !chosen && { opacity: 0.4 },
                    chosen && local.chosen,
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <Text style={local.answerLetter}>{c.label}</Text>
                  {text ? (
                    <Text style={local.answerText} numberOfLines={3}>
                      {text}
                    </Text>
                  ) : null}
                  {!isMc && <Text style={local.answerName}>{c.name}</Text>}
                  {chosen && !pending && (
                    <View style={local.badge}>
                      {lastAnswer?.isCorrect === false ? <X color="white" size={16} /> : <Check color="white" size={16} />}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {effective === "reveal" && q && <Reveal state={state} lastResult={lastResult} />}

      {effective === "leaderboard" && (
        <Center>
          <Trophy color={colors.gold} size={40} />
          <Text style={[styles.body, { marginTop: 10 }]}>Your position</Text>
          <Text style={local.rank}>{state.me.rank ?? "–"}</Text>
          <Text style={[styles.body, { color: colors.text, fontSize: 18 }]}>{state.me.score} points</Text>
          <MiniBoard state={state} />
        </Center>
      )}

      {s.status === "finished" && (
        <Center>
          <Trophy color={state.me.rank === 1 && state.me.score > 0 ? colors.gold : colors.subtle} size={56} />
          <Text style={[styles.label, { marginTop: 12 }]}>Game over</Text>
          <Text style={[styles.big, { marginTop: 6 }]}>
            {state.me.rank === 1 && state.me.score > 0 ? "You won!" : state.me.rank ? `You finished #${state.me.rank}` : "Thanks for playing"}
          </Text>
          <Text style={[styles.body, { color: colors.text, marginTop: 4 }]}>
            {state.me.score} points · {state.me.correctCount} correct
          </Text>
          <MiniBoard state={state} />
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Done" variant="secondary" onPress={onLeave} />
          </View>
        </Center>
      )}

      {s.status === "aborted" && (
        <Center>
          <Text style={styles.big}>The host cancelled this game.</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Back" variant="secondary" onPress={onLeave} />
          </View>
        </Center>
      )}

      {s.status === "paused" && (
        <View style={local.pauseOverlay} accessibilityViewIsModal>
          <Pause color="white" size={40} />
          <Text style={[styles.big, { fontSize: 22, marginTop: 10 }]}>Paused</Text>
          <Text style={styles.body}>The host will resume shortly.</Text>
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
    <View style={[styles.row, { marginTop: 16 }]}>
      <Text style={styles.body}>The answer was</Text>
      <Text style={[local.chip, { backgroundColor: correct.bg }]}>
        {state.session.mode === "multiple_choice" ? correct.label : `${correct.name} ${correct.label}`}
      </Text>
    </View>
  );

  if (state.session.mode === "multiple_choice") {
    const right = mine?.isCorrect === true;
    return (
      <Center>
        <View style={[local.circle, { backgroundColor: !mine ? colors.surface : right ? colors.good : colors.bad }]}>
          {!mine ? <Clock color="white" size={40} /> : right ? <Check color="white" size={40} /> : <X color="white" size={40} />}
        </View>
        <Text style={[styles.big, { marginTop: 14 }]}>{!mine ? "No answer" : right ? "Correct!" : "Not this time"}</Text>
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
          <Crown color={colors.gold} size={56} />
          <Text style={[styles.big, { marginTop: 10 }]}>You got it first!</Text>
          {state.myRoundPoints ? <Text style={local.points}>+{state.myRoundPoints} points</Text> : null}
        </>
      ) : q.winner ? (
        <>
          <Lock color={colors.subtle} size={48} />
          <Text style={[styles.big, { fontSize: 24, marginTop: 10 }]}>{q.winner.displayName} got it first</Text>
        </>
      ) : (
        <Text style={[styles.big, { fontSize: 24 }]}>No winner this time</Text>
      )}
      {answerChip}
    </Center>
  );
}

function MiniBoard({ state }: { state: PlayerState }) {
  if (!state.leaderboard || state.leaderboard.length === 0) return null;
  return (
    <View style={{ alignSelf: "stretch", marginTop: 20, gap: 6 }}>
      {state.leaderboard.slice(0, 5).map((r) => (
        <View key={r.participantId} style={[local.boardRow, r.participantId === state.me.participantId && { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Text style={[local.boardText, { width: 22, color: colors.muted }]}>{r.rank}</Text>
          <Text style={[local.boardText, { flex: 1 }]} numberOfLines={1}>
            {r.displayName}
          </Text>
          <Text style={[local.boardText, { fontWeight: "700" }]}>{r.score}</Text>
        </View>
      ))}
    </View>
  );
}

function TimerBar({ remaining, total }: { remaining: number | null; total: number }) {
  const secs = remaining === null ? null : Math.max(0, Math.ceil(remaining / 1000));
  const frac = remaining === null || total <= 0 ? 1 : Math.max(0, Math.min(1, remaining / total));
  return (
    <View style={[styles.row, { marginBottom: 10 }]} accessibilityRole="timer" accessibilityLabel={secs === null ? "" : `${secs} seconds left`}>
      <View style={local.barTrack}>
        <View style={[local.barFill, { width: `${frac * 100}%`, backgroundColor: frac < 0.25 ? colors.bad : colors.text }]} />
      </View>
      <Text style={[local.headerScore, { width: 32, textAlign: "right" }]}>{secs ?? ""}</Text>
    </View>
  );
}

const local = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  headerName: { color: colors.muted, fontWeight: "600", fontSize: 15, maxWidth: "60%" },
  headerScore: { color: colors.text, fontWeight: "700", fontSize: 15, fontVariant: ["tabular-nums"] },
  countdown: { color: colors.text, fontSize: 96, fontWeight: "800", marginVertical: 12, fontVariant: ["tabular-nums"] },
  status: { textAlign: "center", fontSize: 16, fontWeight: "600", backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 12, overflow: "hidden" },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  answer: { width: "48%", flexGrow: 1, flexBasis: "45%", borderRadius: 20, alignItems: "center", justifyContent: "center", padding: 12, minHeight: 120 },
  chosen: { borderWidth: 4, borderColor: "white" },
  answerLetter: { color: "white", fontSize: 48, fontWeight: "800" },
  answerText: { color: "white", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 6 },
  answerName: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600", marginTop: 2 },
  badge: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 999, padding: 4 },
  rank: { color: colors.text, fontSize: 64, fontWeight: "800", fontVariant: ["tabular-nums"] },
  circle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  points: { color: "#86EFAC", fontSize: 18, marginTop: 6 },
  chip: { color: "white", fontWeight: "800", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  boardText: { color: colors.text, fontSize: 15 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  pauseOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,16,32,0.9)", alignItems: "center", justifyContent: "center", gap: 6 },
});
