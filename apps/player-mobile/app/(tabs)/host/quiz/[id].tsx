import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, ChevronUp, CloudOff, Copy, ImagePlus, Loader, Minus, Play, Plus, Trash2, X,
} from "lucide-react-native";
import {
  ANSWER_COLORS, GAME_MODE_INFO, LIMITS, errorMessage, normalizeSessionSettings, questionIssues, validateQuizForPlay, toAppError,
  type SessionSettings,
} from "@crowdquiz/shared";
import { Backdrop, Glass } from "@/components/glass";
import { Button, Card, Field, Pill, SectionTitle, Toggle, styles } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { applyBackup, clearBackup, readBackup, writeBackup, type LocalBackup } from "@/lib/backup";
import { feel } from "@/lib/haptics";
import { deleteQuestionPhoto, pickQuestionPhoto } from "@/lib/photos";
import { getApi, getSupabase, questionImageUrl } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";
import type { QuestionRow, QuizRow } from "@/lib/types";
import { useAutosave, type SaveStatus } from "@/lib/useAutosave";

const toDraft = (q: QuestionRow) => ({ prompt: q.prompt, choices: q.choices, correctIndex: q.correct_index });

/**
 * Quiz editor. Everything saves by itself as you type: to your account within
 * a second, and to the phone first in case the signal drops. Swiping the app
 * away mid-edit never loses a question.
 */
export default function QuizEditor() {
  const { id: quizId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const api = useMemo(() => getApi(), []);
  const [quiz, setQuiz] = useState<QuizRow | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const fetchQuiz = useCallback(async () => {
    const sb = getSupabase();
    const [qz, qs] = await Promise.all([
      sb.from("quizzes").select("*").eq("id", quizId).maybeSingle(),
      sb.from("questions").select("*").eq("quiz_id", quizId).order("position"),
    ]);
    if (qz.error || qs.error) throw new Error(errorMessage(qz.error ?? qs.error));
    if (!qz.data) throw new Error("This quiz doesn't exist or you don't have access to it.");
    return { quiz: qz.data as QuizRow, rows: (qs.data ?? []) as QuestionRow[] };
  }, [quizId]);

  const apply = useCallback((d: { quiz: QuizRow; rows: QuestionRow[] }, keepOpen: boolean) => {
    setQuiz(d.quiz);
    setQuestions(d.rows);
    setOpen((cur) => (keepOpen && cur && d.rows.some((r) => r.id === cur) ? cur : d.rows[0]?.id ?? null));
  }, []);
  const load = useCallback(async () => apply(await fetchQuiz(), true), [apply, fetchQuiz]);

  // ---- Autosave -----------------------------------------------------------
  const save = useCallback(
    async (keys: Set<string>) => {
      const sb = getSupabase();
      const jobs: Array<PromiseLike<{ error: unknown }>> = [];
      if (keys.has("meta") && quiz) {
        jobs.push(sb.from("quizzes").update({ title: quiz.title.trim() || "Untitled quiz", description: quiz.description || null }).eq("id", quiz.id));
      }
      if (keys.has("settings") && quiz) jobs.push(sb.from("quizzes").update({ settings: quiz.settings }).eq("id", quiz.id));
      for (const q of questions) {
        if (keys.has(q.id)) {
          jobs.push(
            sb.from("questions").update({
              prompt: q.prompt, choices: q.choices, correct_index: q.correct_index, time_limit_seconds: q.time_limit_seconds, media: q.media,
            }).eq("id", q.id),
          );
        }
      }
      const results = await Promise.all(jobs);
      const failed = results.find((r) => r.error);
      if (failed) throw new Error(errorMessage(failed.error));
      const { data } = await sb.from("quizzes").select("status, updated_at").eq("id", quizId).maybeSingle();
      if (data) setQuiz((cur) => (cur ? { ...cur, ...data } : cur));
    },
    [quiz, questions, quizId],
  );
  const autosave = useAutosave(save);
  const { markDirty, unsavedKeys } = autosave;

  // Edits from this phone that never reached the server are put back on top of the server copy.
  useEffect(() => {
    void (async () => {
      try {
        const d = await fetchQuiz();
        const keys = applyBackup(await readBackup(quizId), d);
        for (const k of keys) markDirty(k);
        apply(d, false);
        if (keys.size) setNotice("Restored changes that hadn't finished saving.");
        else clearBackup(quizId);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : errorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchQuiz, apply, quizId]);

  // Keep a copy of not-yet-saved edits on the phone until the server has them.
  useEffect(() => {
    if (!quiz) return;
    const keys = unsavedKeys();
    const backup: Omit<LocalBackup, "savedAt"> = { questions: {} };
    if (keys.has("meta")) backup.meta = { title: quiz.title, description: quiz.description };
    if (keys.has("settings")) backup.settings = quiz.settings;
    for (const q of questions) {
      if (keys.has(q.id)) {
        backup.questions[q.id] = { prompt: q.prompt, choices: q.choices, correct_index: q.correct_index, time_limit_seconds: q.time_limit_seconds, media: q.media };
      }
    }
    writeBackup(quiz.id, backup);
  }, [quiz, questions, autosave.status, unsavedKeys]);

  const updateQuestion = (qid: string, patch: Partial<QuestionRow>) => {
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, ...patch } : q)));
    markDirty(qid);
  };
  const updateMeta = (patch: Partial<QuizRow>) => {
    setQuiz((q) => (q ? { ...q, ...patch } : q));
    markDirty("meta");
  };

  // ---- Structure changes (save pending edits first) -------------------------
  const structural = async (fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    if (!(await autosave.flush())) {
      setBusy(false);
      return setNotice("Couldn't save your changes. Check your connection and try again.");
    }
    try {
      const r = await fn();
      await load();
      after?.(r);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const index = questions.findIndex((q) => q.id === open);
  const current = index >= 0 ? questions[index]! : null;
  const addQuestion = () => {
    feel.tap();
    return structural(() => api.addQuestion(quizId, current ? current.position : questions.length ? questions[questions.length - 1]!.position : null), (r) => setOpen((r as { id: string }).id));
  };
  const duplicate = (q: QuestionRow) => structural(() => api.duplicateQuestion(q.id), (r) => setOpen((r as { id: string }).id));
  const confirmRemove = (q: QuestionRow) =>
    Alert.alert("Delete question?", "This question will be removed from the quiz.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const i = questions.findIndex((x) => x.id === q.id);
          const next = questions[i + 1]?.id ?? questions[i - 1]?.id ?? null;
          void structural(async () => {
            await api.deleteQuestion(q.id);
            if (q.media) void deleteQuestionPhoto(q.media.path);
          }, () => setOpen(next));
        },
      },
    ]);
  const move = (q: QuestionRow, dir: -1 | 1) => {
    const i = questions.findIndex((x) => x.id === q.id);
    const to = i + dir;
    if (to < 0 || to >= questions.length) return;
    feel.select();
    const ids = questions.map((x) => x.id);
    [ids[i], ids[to]] = [ids[to]!, ids[i]!];
    setQuestions((qs) => ids.map((qid, n) => ({ ...qs.find((x) => x.id === qid)!, position: n })));
    void structural(() => api.reorderQuestions(quizId, ids));
  };

  const addPhoto = async (q: QuestionRow) => {
    if (!user) return;
    setUploading(q.id);
    try {
      const media = await pickQuestionPhoto();
      if (media) {
        const old = q.media?.path;
        updateQuestion(q.id, { media });
        if (old) void deleteQuestionPhoto(old);
        feel.right();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't add the photo.");
    } finally {
      setUploading(null);
    }
  };
  const removePhoto = (q: QuestionRow) => {
    const old = q.media?.path;
    updateQuestion(q.id, { media: null });
    if (old) void deleteQuestionPhoto(old);
  };

  const issues = useMemo(() => validateQuizForPlay(questions.map(toDraft)), [questions]);

  const launch = async () => {
    setLaunchError(null);
    setLaunching(true);
    try {
      if (!(await autosave.flush())) throw new Error("Couldn't save your changes. Check your connection and try again.");
      if (quiz?.status === "draft") {
        const { error } = await getSupabase().from("quizzes").update({ status: "ready" }).eq("id", quizId);
        if (error) throw error;
      }
      const s = await api.createSession(quizId, {});
      feel.go();
      router.push({ pathname: "/run/[sessionId]", params: { sessionId: s.sessionId } });
    } catch (e) {
      const code = toAppError(e).code;
      setLaunchError(
        code === "no_entitlement" || code === "session_limit_reached"
          ? "This account isn't set up to host games yet. Contact support to turn hosting on."
          : errorMessage(e),
      );
      feel.wrong();
    } finally {
      setLaunching(false);
    }
  };

  const confirmDeleteQuiz = () =>
    Alert.alert("Delete this quiz?", "The quiz and all its questions will be deleted. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete quiz",
        style: "destructive",
        onPress: async () => {
          const paths = questions.map((q) => q.media?.path).filter((p): p is string => !!p);
          const { error } = await getSupabase().from("quizzes").delete().eq("id", quizId);
          if (error) return setNotice(errorMessage(error));
          clearBackup(quizId);
          for (const p of paths) void deleteQuestionPhoto(p);
          router.back();
        },
      },
    ]);

  const quizMenu = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Game settings", "Delete quiz", "Cancel"], destructiveButtonIndex: 1, cancelButtonIndex: 2, userInterfaceStyle: "dark" },
        (i) => {
          if (i === 0) setShowSettings((v) => !v);
          if (i === 1) confirmDeleteQuiz();
        },
      );
    } else {
      Alert.alert("Quiz", undefined, [
        { text: "Game settings", onPress: () => setShowSettings((v) => !v) },
        { text: "Delete quiz", style: "destructive", onPress: confirmDeleteQuiz },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  if (loadError) {
    return (
      <View style={styles.root}>
        <Backdrop />
        <View style={{ padding: space.xl, paddingTop: 120, gap: space.lg }}>
          <Text style={styles.error}>{loadError}</Text>
          <Button title="Back" variant="glass" onPress={() => router.back()} />
        </View>
      </View>
    );
  }
  if (!quiz) return <View style={styles.root}><Backdrop /></View>;

  const settings = normalizeSessionSettings(quiz.mode, quiz.settings);
  const setSetting = (patch: Partial<SessionSettings>) => {
    setQuiz((q) => (q ? { ...q, settings: { ...settings, ...patch } as unknown as Record<string, unknown> } : q));
    markDirty("settings");
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <View style={styles.row}>
              <SaveIndicator status={autosave.status} onRetry={() => void autosave.flush()} />
              <Pressable onPress={quizMenu} accessibilityRole="button" accessibilityLabel="More" hitSlop={10}>
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", paddingHorizontal: 6 }}>⋯</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 160 }}
      >
        <View style={{ gap: 8 }}>
          <TextInput
            value={quiz.title}
            onChangeText={(t) => updateMeta({ title: t })}
            maxLength={LIMITS.quizTitle}
            accessibilityLabel="Quiz title"
            placeholder="Quiz title"
            placeholderTextColor={colors.subtle}
            keyboardAppearance="dark"
            style={{ color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.4, padding: 0 }}
          />
          <View style={styles.row}>
            <Pill tone="primary">{GAME_MODE_INFO[quiz.mode].name}</Pill>
            <Pill tone={quiz.status === "ready" ? "good" : "neutral"}>{quiz.status === "ready" ? "Ready" : "Draft"}</Pill>
          </View>
          {quiz.status === "draft" ? (
            <Text style={[styles.small, { color: colors.subtle }]}>
              Drafts are kept for 60 days after your last edit, then deleted. Photos are removed 30 days after a quiz's last game.
            </Text>
          ) : null}
        </View>

        {notice ? (
          <Pressable onPress={() => setNotice(null)}>
            <Glass tint="rgba(251,191,36,0.35)" radiusSize={radius.md} style={{ padding: space.md }}>
              <Text style={{ color: colors.text, fontWeight: "600" }}>{notice}</Text>
            </Glass>
          </Pressable>
        ) : null}

        {showSettings && (
          <Card style={{ gap: 4 }}>
            <Text style={styles.h2}>Game settings</Text>
            <Text style={[styles.small, { marginBottom: 6 }]}>Used every time you start this quiz.</Text>
            {quiz.mode === "multiple_choice" && (
              <Stepper label="Time per question" value={settings.timeLimitSeconds} min={5} max={120} step={5} suffix="s" onChange={(v) => setSetting({ timeLimitSeconds: v })} />
            )}
            {quiz.mode === "multiple_choice" && <Toggle label="Speed bonus" hint="Faster correct answers earn extra points." value={settings.speedBonus} onValueChange={(v) => setSetting({ speedBonus: v })} />}
            {quiz.mode === "multiple_choice" && <Toggle label="Allow changing answers" value={settings.allowAnswerChange} onValueChange={(v) => setSetting({ allowAnswerChange: v })} />}
            {quiz.mode === "color_buzzer" && <Toggle label="Lock out wrong buzzes" hint="A wrong press locks that player out of the question." value={settings.buzzerLockout} onValueChange={(v) => setSetting({ buzzerLockout: v })} />}
            <Toggle label="Show leaderboard between questions" value={settings.showLeaderboard} onValueChange={(v) => setSetting({ showLeaderboard: v })} />
            <Toggle label="Allow late joiners" value={settings.allowLateJoin} onValueChange={(v) => setSetting({ allowLateJoin: v })} />
            <Toggle label="Music on the big screen" value={settings.soundOn} onValueChange={(v) => setSetting({ soundOn: v })} />
          </Card>
        )}

        <SectionTitle>Questions ({questions.length})</SectionTitle>
        {questions.length === 0 && <Text style={styles.body}>No questions yet. Add your first one.</Text>}

        {questions.map((q, i) => {
          const bad = questionIssues(toDraft(q), i).length > 0;
          const expanded = q.id === open;
          return (
            <Card key={q.id} style={{ gap: space.md, padding: 0 }}>
              <Pressable
                onPress={() => {
                  feel.select();
                  setOpen(expanded ? null : q.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}
              >
                <Text style={[styles.small, { width: 22, fontWeight: "800" }]}>{i + 1}</Text>
                <Text style={[styles.body, { flex: 1, color: q.prompt.trim() ? colors.text : colors.subtle, fontStyle: q.prompt.trim() ? "normal" : "italic" }]} numberOfLines={2}>
                  {q.prompt.trim() || "Untitled question"}
                </Text>
                {q.media ? <ImagePlus color={colors.muted} size={16} /> : null}
                {bad ? <AlertCircle color={colors.warn} size={20} /> : <CheckCircle2 color={colors.good} size={20} />}
                {expanded ? <ChevronUp color={colors.muted} size={20} /> : <ChevronDown color={colors.muted} size={20} />}
              </Pressable>

              {expanded && (
                <View style={{ gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg }}>
                  <Field
                    label={`Question (${q.prompt.length}/${LIMITS.prompt})`}
                    value={q.prompt}
                    onChangeText={(t) => updateQuestion(q.id, { prompt: t })}
                    maxLength={LIMITS.prompt}
                    placeholder="Type your question"
                    multiline
                  />

                  <View style={{ gap: 8 }}>
                    <Text style={styles.fieldLabel}>Photo (shown on the big screen)</Text>
                    {q.media ? (
                      <View style={{ gap: 8 }}>
                        <Image source={{ uri: questionImageUrl(q.media.path) ?? undefined }} style={{ width: "100%", height: 180, borderRadius: radius.md, backgroundColor: colors.glass }} resizeMode="cover" accessibilityLabel="Question photo" />
                        <View style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Button title="Change photo" variant="glass" small onPress={() => addPhoto(q)} loading={uploading === q.id} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Button title="Remove" variant="glass" small onPress={() => removePhoto(q)} icon={<X color={colors.text} size={16} />} />
                          </View>
                        </View>
                      </View>
                    ) : (
                      <Button title="Add a photo" variant="glass" small onPress={() => addPhoto(q)} loading={uploading === q.id} icon={<ImagePlus color={colors.text} size={18} />} />
                    )}
                  </View>

                  <View style={{ gap: 10 }}>
                    <Text style={styles.fieldLabel}>Answers. Tap the circle to mark the correct one.</Text>
                    {ANSWER_COLORS.map((c, n) => {
                      const correct = q.correct_index === n;
                      return (
                        <View key={c.label} style={[styles.row, { gap: 10 }]}>
                          <Glass tint={c.bg} radiusSize={12} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "white", fontWeight: "900", fontSize: 18 }}>{c.label}</Text>
                          </Glass>
                          <TextInput
                            value={q.choices[n] ?? ""}
                            onChangeText={(t) => {
                              const choices = [...q.choices] as QuestionRow["choices"];
                              choices[n] = t;
                              updateQuestion(q.id, { choices });
                            }}
                            maxLength={LIMITS.choice}
                            placeholder={`Answer ${c.label}`}
                            placeholderTextColor={colors.subtle}
                            accessibilityLabel={`Answer ${c.label} (${c.name})`}
                            keyboardAppearance="dark"
                            style={[styles.input, { flex: 1, minHeight: 48, fontSize: 16 }, correct && { borderColor: colors.good, borderWidth: 2 }]}
                          />
                          <Pressable
                            onPress={() => {
                              feel.select();
                              updateQuestion(q.id, { correct_index: n });
                            }}
                            accessibilityRole="radio"
                            accessibilityLabel={`Mark ${c.label} as correct`}
                            accessibilityState={{ selected: correct }}
                            hitSlop={8}
                          >
                            <Glass tint={correct ? colors.good : undefined} radiusSize={999} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                              {correct ? <Check color="white" size={22} strokeWidth={3} /> : null}
                            </Glass>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>

                  {quiz.mode === "multiple_choice" && (
                    <Stepper
                      label={q.time_limit_seconds ? "Timer for this question" : `Timer: game default (${settings.timeLimitSeconds}s)`}
                      value={q.time_limit_seconds ?? settings.timeLimitSeconds}
                      min={5}
                      max={120}
                      step={5}
                      suffix="s"
                      onChange={(v) => updateQuestion(q.id, { time_limit_seconds: v })}
                      onReset={q.time_limit_seconds ? () => updateQuestion(q.id, { time_limit_seconds: null }) : undefined}
                    />
                  )}

                  <View style={[styles.row, { flexWrap: "wrap" }]}>
                    <Button title="Up" variant="glass" small onPress={() => move(q, -1)} disabled={busy || i === 0} />
                    <Button title="Down" variant="glass" small onPress={() => move(q, 1)} disabled={busy || i === questions.length - 1} />
                    <Button title="Duplicate" variant="glass" small onPress={() => duplicate(q)} disabled={busy} icon={<Copy color={colors.text} size={16} />} />
                    <Button title="Delete" variant="danger" small onPress={() => confirmRemove(q)} disabled={busy} icon={<Trash2 color={colors.text} size={16} />} />
                  </View>
                </View>
              )}
            </Card>
          );
        })}

        <Button title="Add question" variant="glass" onPress={addQuestion} disabled={busy || questions.length >= LIMITS.maxQuestions} icon={<Plus color={colors.text} size={20} />} />

        {issues.length > 0 && questions.length > 0 && (
          <Card tint="rgba(251,191,36,0.25)" style={{ gap: 4 }}>
            <Text style={[styles.h2, { fontSize: 16 }]}>Before you can start</Text>
            {issues.slice(0, 5).map((m) => (
              <Text key={m} style={styles.body}>• {m}</Text>
            ))}
            {issues.length > 5 && <Text style={styles.body}>and {issues.length - 5} more</Text>}
          </Card>
        )}

        {launchError ? <Text style={styles.error} accessibilityRole="alert">{launchError}</Text> : null}
        <Button title="Start a game" onPress={launch} loading={launching} disabled={issues.length > 0} icon={<Play color={colors.text} size={20} />} />
      </ScrollView>
    </View>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "saving") return <View style={styles.row}><Loader color={colors.muted} size={14} /><Text style={styles.small}>Saving</Text></View>;
  if (status === "saved") return <View style={styles.row}><Check color={colors.good} size={14} /><Text style={[styles.small, { color: colors.good }]}>Saved</Text></View>;
  if (status === "error") {
    return (
      <Pressable onPress={onRetry} style={styles.row} accessibilityRole="button" accessibilityLabel="Not saved. Retry">
        <CloudOff color={colors.warn} size={14} />
        <Text style={[styles.small, { color: colors.warn }]}>Not saved. Retry</Text>
      </Pressable>
    );
  }
  return null;
}

function Stepper({
  label, value, min, max, step, suffix, onChange, onReset,
}: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void; onReset?: () => void;
}) {
  const set = (v: number) => {
    feel.select();
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>{label}</Text>
        {onReset ? <Text style={[styles.small, { color: colors.primary }]} onPress={onReset}>Use game default</Text> : null}
      </View>
      <Pressable onPress={() => set(value - step)} accessibilityRole="button" accessibilityLabel="Less" hitSlop={8}>
        <Glass radiusSize={999} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Minus color={colors.text} size={20} /></Glass>
      </Pressable>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", minWidth: 52, textAlign: "center", fontVariant: ["tabular-nums"] }}>
        {value}{suffix}
      </Text>
      <Pressable onPress={() => set(value + step)} accessibilityRole="button" accessibilityLabel="More" hitSlop={8}>
        <Glass radiusSize={999} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Plus color={colors.text} size={20} /></Glass>
      </Pressable>
    </View>
  );
}
