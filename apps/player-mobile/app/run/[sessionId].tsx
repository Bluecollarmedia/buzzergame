import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { ArrowRight, Check, Crown, Flag, Pause, Play, RotateCcw, Share2, SkipForward, Square, UserX, Volume2, VolumeX, X } from "lucide-react-native";
import {
  ANSWER_COLORS, GAME_MODE_INFO, STATUS_LABELS, allowedHostCommands, buildJoinUrl, buildProjectorUrl, errorMessage, formatRoomCode,
  type HostCommand, type HostState,
} from "@crowdquiz/shared";
import { Glass } from "@/components/glass";
import { TimerRing } from "@/components/game";
import { QrView } from "@/components/QrView";
import { Button, Card, Center, Pill, PulseDot, Screen, SectionTitle, styles } from "@/components/ui";
import { config } from "@/lib/config";
import { feel } from "@/lib/haptics";
import { getApi, questionImageUrl } from "@/lib/supabase";
import { useCountdown, useSessionSync } from "@/lib/useSessionSync";
import { colors, radius, space } from "@/lib/theme";

/** Run a live game from the phone: lobby with QR code, then the controls. */
export default function RunGame() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  useKeepAwake();
  const api = useMemo(() => getApi(), []);
  const fetchState = useCallback(() => api.hostState(sessionId), [api, sessionId]);
  const { state, connection, fatal, clock, refresh } = useSessionSync<HostState>({ sessionId, fetchState, events: ["state", "roster", "answers"], heartbeatMs: 10000 });
  const [pending, setPending] = useState<HostCommand | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [soundBusy, setSoundBusy] = useState(false);
  const [relaunching, setRelaunching] = useState(false);

  const s = state?.session;
  const q = state?.question;
  const deadline = s?.status === "question_open" ? q?.deadline : s?.status === "countdown" || s?.status === "reveal" || s?.status === "leaderboard" ? s.phaseEndsAt : null;
  const remaining = useCountdown(clock, deadline, s?.status === "paused" ? s.pausedRemainingMs : undefined);

  const base = config.siteUrl;
  const joinUrl = state && base ? buildJoinUrl(base, state.join.joinToken) : "";
  const projectorUrl = state && base ? buildProjectorUrl(base, state.join.projectorToken) : "";

  // A light tap whenever someone joins the lobby.
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    if (!s) return;
    if (lastCount.current !== null && s.playerCount > lastCount.current) feel.tap();
    lastCount.current = s.playerCount;
  }, [s]);

  const run = async (cmd: HostCommand, args: Record<string, unknown> = {}) => {
    if (!s) return;
    setPending(cmd);
    setNotice(null);
    try {
      const r = await api.hostCommand(sessionId, cmd, cmd === "remove_player" ? null : s.stateVersion, args);
      if (!r.applied) setNotice("The game moved on before that took effect. Check the screen and try again.");
      else feel.tap();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setPending(null);
      void refresh();
    }
  };
  const confirm = (title: string, body: string, label: string, onYes: () => void, destructive = false) =>
    Alert.alert(title, body, [{ text: "Cancel", style: "cancel" }, { text: label, style: destructive ? "destructive" : "default", onPress: onYes }]);

  const connectedIds = useMemo(() => {
    if (!state || !clock) return new Set<string>();
    const now = clock.serverNow();
    return new Set(state.players.filter((p) => now - Date.parse(p.lastSeenAt) < 45000).map((p) => p.participantId));
  }, [state, clock]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/host"));

  if (fatal) {
    return (
      <Screen>
        <Center>
          <Text style={styles.big}>{fatal.message}</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}><Button title="Back" variant="glass" onPress={leave} /></View>
        </Center>
      </Screen>
    );
  }
  if (!state || !s) {
    return (
      <Screen>
        <Center>
          <PulseDot color={colors.primary} size={14} />
          <Text style={[styles.body, { marginTop: 14 }]}>Connecting to the game…</Text>
        </Center>
      </Screen>
    );
  }

  const allowed = new Set(allowedHostCommands(s.status, { allowReplay: s.settings.allowReplay }));
  const isMc = s.mode === "multiple_choice";
  const effective = s.status === "paused" ? s.pausedFrom : s.status;
  const totalMs = effective === "question_open" && q?.deadline && q.startedAt ? Date.parse(q.deadline) - Date.parse(q.startedAt) : (s.settings.countdownSeconds ?? 3) * 1000;
  const ended = s.status === "finished" || s.status === "aborted";
  const imageUrl = questionImageUrl(q?.imagePath);

  const playAgain = async () => {
    setRelaunching(true);
    try {
      const res = await api.sessionResults(sessionId);
      if (!res.session.quizId) throw new Error("The original quiz was deleted, so it can't be played again.");
      const n = await api.createSession(res.session.quizId, {});
      router.replace({ pathname: "/run/[sessionId]", params: { sessionId: n.sessionId } });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setRelaunching(false);
    }
  };

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 8 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Pill tone={s.status === "question_open" ? "good" : s.status === "paused" ? "warn" : "neutral"}>{STATUS_LABELS[s.status]}</Pill>
            <Button title="Close" variant="ghost" small onPress={leave} />
          </View>
          <Text style={styles.h1} numberOfLines={2}>{s.title}</Text>
          <Text style={styles.small}>
            {GAME_MODE_INFO[s.mode].name}
            {s.currentPosition !== null ? ` · Question ${s.currentPosition + 1} of ${s.questionCount}` : ""} · {s.playerCount} {s.playerCount === 1 ? "player" : "players"}
            {connection !== "live" ? " · reconnecting…" : ""}
          </Text>
        </View>

        {notice ? <Text style={[styles.body, { color: colors.warn }]} accessibilityRole="alert">{notice}</Text> : null}

        {s.status === "lobby" && (
          <Card style={{ alignItems: "center", gap: space.lg }}>
            {joinUrl ? <QrView value={joinUrl} size={230} /> : <Text style={styles.error}>Site address is missing from this build, so the QR code can&apos;t be drawn. Players can still use the room code.</Text>}
            <View style={{ alignItems: "center" }}>
              <Text style={styles.small}>Room code</Text>
              <Text style={{ color: colors.text, fontSize: 44, fontWeight: "900", letterSpacing: 6 }} testID="room-code">{formatRoomCode(state.join.roomCode)}</Text>
            </View>
            <Text style={[styles.body, { textAlign: "center" }]}>Show this to your players. Open the big-screen link on a laptop or TV so everyone can see the questions.</Text>
            <View style={[styles.row, { flexWrap: "wrap", justifyContent: "center" }]}>
              {joinUrl ? <Button title="Share join link" variant="glass" small onPress={() => Share.share({ message: joinUrl })} icon={<Share2 color={colors.text} size={16} />} /> : null}
              {projectorUrl ? <Button title="Share big-screen link" variant="glass" small onPress={() => Share.share({ message: projectorUrl })} icon={<Share2 color={colors.text} size={16} />} /> : null}
            </View>
          </Card>
        )}

        {effective === "countdown" && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <TimerRing remainingMs={remaining} totalMs={totalMs} size={84} />
            <View style={{ flex: 1 }}>
              <Text style={styles.small}>Up next · Question {(s.currentPosition ?? 0) + 1}</Text>
              <Text style={styles.h2}>{state.question?.prompt ?? state.nextQuestion?.prompt ?? ""}</Text>
            </View>
          </Card>
        )}

        {(effective === "question_open" || effective === "reveal" || effective === "leaderboard") && q && (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.small}>Question {q.position + 1}</Text>
                <Text style={styles.h2}>{q.prompt}</Text>
              </View>
              {isMc || q.deadline ? <TimerRing remainingMs={effective === "question_open" ? remaining : 0} totalMs={totalMs} size={72} /> : null}
            </View>
            {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 170, borderRadius: radius.md }} resizeMode="cover" accessibilityLabel="Question photo" /> : null}
            <View style={{ gap: 8 }}>
              {ANSWER_COLORS.map((c, i) => {
                const correct = q.correctIndex === i;
                const count = q.distribution?.[i];
                return (
                  <Glass key={c.label} tint={correct ? "rgba(52,211,153,0.45)" : undefined} radiusSize={radius.md} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10 }}>
                    <Glass tint={c.bg} radiusSize={9} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "white", fontWeight: "900" }}>{c.label}</Text>
                    </Glass>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" }}>{q.choices?.[i]}</Text>
                    {count !== undefined && <Text style={{ color: colors.text, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{count}</Text>}
                    {correct && <Check color={colors.good} size={20} />}
                  </Glass>
                );
              })}
            </View>
            {isMc ? (
              <Text style={[styles.body, { color: colors.text, fontWeight: "700" }]}>{q.answerCount ?? 0} of {s.playerCount} answered</Text>
            ) : q.winner ? (
              <View style={styles.row}>
                <Crown color={colors.gold} size={18} />
                <Text style={[styles.body, { color: colors.good, fontWeight: "700" }]}>{q.winner.displayName} won with {ANSWER_COLORS[q.winner.choiceIndex]!.name}</Text>
              </View>
            ) : q.roundStatus === "closed" ? (
              <Text style={styles.body}>No winner this time</Text>
            ) : (
              <Text style={styles.body}>Waiting for the first correct buzz…</Text>
            )}
            {!isMc && state.attempts.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Buzzes</Text>
                {state.attempts.map((a, i) => (
                  <View key={`${a.participantId}-${a.attemptNo}`} style={styles.row}>
                    <Text style={[styles.small, { width: 20 }]}>{i + 1}</Text>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ANSWER_COLORS[a.choiceIndex]!.bg }} />
                    <Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>{a.displayName}</Text>
                    {a.isCorrect ? <Check color={colors.good} size={18} /> : <X color={colors.bad} size={18} />}
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

        {s.status === "paused" && (
          <Card tint="rgba(251,191,36,0.3)"><Text style={styles.body}>The game is paused. Players can&apos;t answer until you resume.</Text></Card>
        )}

        {ended && (
          <Card style={{ gap: space.md }}>
            <Text style={styles.h1}>{s.status === "finished" ? "Final standings" : "Game cancelled"}</Text>
            {s.status === "finished" && <Standings rows={state.results?.standings ?? state.leaderboard} />}
            <Button title="Play again" onPress={playAgain} loading={relaunching} icon={<RotateCcw color={colors.text} size={20} />} />
            <Button title="Done" variant="glass" onPress={leave} />
          </Card>
        )}

        {!ended && (
          <View style={{ gap: space.md }}>
            <SectionTitle>Controls</SectionTitle>
            {allowed.has("start") && <Button title="Start game" onPress={() => run("start")} loading={pending === "start"} disabled={s.playerCount === 0} icon={<Play color={colors.text} size={20} />} />}
            {allowed.has("start") && s.playerCount === 0 && <Text style={styles.small}>Waiting for at least one player to join.</Text>}
            {allowed.has("resume") && <Button title="Resume" onPress={() => run("resume")} loading={pending === "resume"} icon={<Play color={colors.text} size={20} />} />}
            {allowed.has("next") && (
              <Button
                title={s.status === "countdown" ? "Start question now" : s.currentPosition !== null && s.currentPosition + 1 >= s.questionCount && s.status === "reveal" ? "Show final results" : "Next"}
                onPress={() => run("next")}
                loading={pending === "next"}
                icon={<ArrowRight color={colors.text} size={20} />}
              />
            )}
            {allowed.has("close_question") && (
              <Button title={isMc ? "End question now" : "End with no winner"} variant="glass" onPress={() => run("close_question")} loading={pending === "close_question"} icon={<Square color={colors.text} size={18} />} />
            )}
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              {allowed.has("pause") && <Button title="Pause" variant="glass" small onPress={() => run("pause")} loading={pending === "pause"} icon={<Pause color={colors.text} size={16} />} />}
              {allowed.has("skip") && (
                <Button title="Skip" variant="glass" small onPress={() => confirm("Skip ahead?", s.status === "question_open" ? "This question will be discarded without awarding points." : "Move straight to the next question.", "Skip", () => run("skip"))} icon={<SkipForward color={colors.text} size={16} />} />
              )}
              {allowed.has("replay") && (
                <Button title="Replay" variant="glass" small onPress={() => confirm("Replay this question?", "Points from the previous attempt are removed and everyone answers again.", "Replay", () => run("replay"))} icon={<RotateCcw color={colors.text} size={16} />} />
              )}
              <Button
                title={s.settings.soundOn === false ? "Music off" : "Music on"}
                variant="glass"
                small
                loading={soundBusy}
                onPress={async () => {
                  setSoundBusy(true);
                  try {
                    await api.setProjectorSound(sessionId, s.settings.soundOn === false);
                    await refresh();
                  } catch (e) {
                    setNotice(errorMessage(e));
                  } finally {
                    setSoundBusy(false);
                  }
                }}
                icon={s.settings.soundOn === false ? <VolumeX color={colors.text} size={16} /> : <Volume2 color={colors.text} size={16} />}
              />
            </View>
            {allowed.has("end") && (
              <Button
                title={s.status === "lobby" ? "Cancel game" : "End game"}
                variant="danger"
                small
                onPress={() =>
                  confirm(
                    s.status === "lobby" ? "Cancel this game?" : "End the game now?",
                    s.status === "lobby" ? "Players in the lobby will see that the game was cancelled." : "Scores so far become the final results. Any open question is discarded.",
                    s.status === "lobby" ? "Cancel game" : "End game",
                    () => run("end"),
                    true,
                  )
                }
                icon={<Flag color={colors.text} size={16} />}
              />
            )}
            {s.status !== "lobby" && !s.settings.autoAdvance && (s.status === "reveal" || s.status === "leaderboard") && (
              <Text style={styles.small}>Automatic progression is off. Press Next to continue.</Text>
            )}
          </View>
        )}

        {s.status !== "lobby" && !ended && state.leaderboard.length > 0 && (
          <View style={{ gap: space.md }}>
            <SectionTitle>Scores</SectionTitle>
            <Standings rows={state.leaderboard} limit={10} />
          </View>
        )}

        {!ended && state.players.length > 0 && (
          <View style={{ gap: space.md }}>
            <SectionTitle>Players ({connectedIds.size} of {state.players.length} connected)</SectionTitle>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {state.players.map((p) => (
                <Pressable
                  key={p.participantId}
                  onPress={() =>
                    confirm("Remove player?", `Remove ${p.displayName} from this game? They won't be able to rejoin.`, "Remove", () => run("remove_player", { participantId: p.participantId }), true)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.displayName}`}
                >
                  <Glass radiusSize={999} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: connectedIds.has(p.participantId) ? colors.good : "rgba(255,255,255,0.3)" }} />
                    <Text style={{ color: colors.text, fontWeight: "600" }}>{p.displayName}</Text>
                    <UserX color={colors.subtle} size={14} />
                  </Glass>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Standings({ rows, limit = 20 }: { rows: HostState["leaderboard"]; limit?: number }) {
  if (!rows || rows.length === 0) return <Text style={styles.body}>No scores yet.</Text>;
  return (
    <View style={{ gap: 6 }}>
      {rows.slice(0, limit).map((r) => (
        <Glass key={r.participantId} radiusSize={radius.md} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 11 }}>
          <Text style={{ width: 26, color: colors.muted, fontWeight: "700" }}>{r.rank}</Text>
          <Text style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>{r.displayName}</Text>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{r.score}</Text>
        </Glass>
      ))}
    </View>
  );
}
