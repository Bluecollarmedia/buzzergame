import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import { Hand, Timer } from "lucide-react-native";
import { GAME_MODE_INFO, LIMITS, errorMessage, type GameMode } from "@crowdquiz/shared";
import { Backdrop, Glass } from "@/components/glass";
import { AuthGate } from "@/components/AuthGate";
import { Button, Field, styles } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { feel } from "@/lib/haptics";
import { getApi, getSupabase } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";

const DRAFT = () => new File(Paths.document, "new-quiz-form.json");

/** Pick a mode and a title. The half-filled form is kept if the sheet is swiped away. */
export default function NewQuiz() {
  const { user } = useAuth();
  const [mode, setMode] = useState<GameMode | null>(null);
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const f = DRAFT();
        if (f.exists) {
          const d = JSON.parse(await f.text()) as { mode?: GameMode | null; title?: string };
          if (d.title) setTitle(d.title);
          if (d.mode) setMode(d.mode);
        }
      } catch {
        /* nothing saved */
      }
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      const f = DRAFT();
      if (title || mode) {
        if (!f.exists) f.create();
        f.write(JSON.stringify({ mode, title }));
      } else if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  }, [loaded, mode, title]);

  const create = async () => {
    if (!mode) return setError("Choose a game mode.");
    if (!title.trim()) return setError("Give your quiz a title.");
    setBusy(true);
    setError(null);
    const sb = getSupabase();
    const { data: u } = await sb.auth.getUser();
    const { data, error: err } = await sb.from("quizzes").insert({ owner_id: u.user?.id, title: title.trim(), mode }).select("id").single();
    if (err || !data) {
      setBusy(false);
      return setError(errorMessage(err));
    }
    try {
      await getApi().addQuestion(data.id);
    } catch {
      /* the editor offers "Add question" anyway */
    }
    try {
      const f = DRAFT();
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
    feel.right();
    router.replace({ pathname: "/host/quiz/[id]", params: { id: data.id } });
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 60 }}>
        {!user ? (
          <AuthGate reason="Sign in to create a quiz." />
        ) : (
          <>
            <Text style={styles.label}>Game mode</Text>
            {(["multiple_choice", "color_buzzer"] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable key={m} onPress={() => { feel.select(); setMode(m); }} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Glass tint={on ? colors.primary : undefined} radiusSize={radius.lg} style={{ padding: space.lg, flexDirection: "row", gap: space.md, alignItems: "center" }}>
                    {m === "multiple_choice" ? <Timer color={colors.text} size={28} /> : <Hand color={colors.text} size={28} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.h2}>{GAME_MODE_INFO[m].name}</Text>
                      <Text style={styles.small}>{GAME_MODE_INFO[m].summary}</Text>
                    </View>
                  </Glass>
                </Pressable>
              );
            })}
            <Field label="Quiz title" value={title} onChangeText={setTitle} maxLength={LIMITS.quizTitle} placeholder="Friday night trivia" returnKeyType="done" />
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <Button title="Create and add questions" onPress={create} loading={busy} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
