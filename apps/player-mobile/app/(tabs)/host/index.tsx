import { useCallback, useState } from "react";
import { RefreshControl, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack, useFocusEffect } from "expo-router";
import { ChevronRight, Plus, Radio } from "lucide-react-native";
import { GAME_MODE_INFO, errorMessage } from "@crowdquiz/shared";
import { Backdrop } from "@/components/glass";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, Empty, Pill, SectionTitle, styles } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { LIVE_STATUSES, type QuizRow, type SessionRow } from "@/lib/types";
import { colors, space } from "@/lib/theme";

/** Host: live games to rejoin, then your quizzes (every quiz is a saved draft until you mark it ready). */
export default function HostHome() {
  const { user, ready } = useAuth();
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [live, setLive] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const sb = getSupabase();
    const [qz, ss] = await Promise.all([
      sb.from("quizzes").select("*, questions(count)").order("updated_at", { ascending: false }),
      sb.from("game_sessions").select("id, quiz_id, quiz_title, mode, status, room_code, question_count, created_at").in("status", LIVE_STATUSES).order("created_at", { ascending: false }),
    ]);
    if (qz.error || ss.error) return setError(errorMessage(qz.error ?? ss.error));
    setError(null);
    setQuizzes((qz.data ?? []) as QuizRow[]);
    setLive((ss.data ?? []) as SessionRow[]);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!ready) return <View style={styles.root}><Backdrop /></View>;

  return (
    <View style={styles.root}>
      <Backdrop />
      <Stack.Screen
        options={{
          headerRight: user ? () => (
            <Pressable onPress={() => router.push("/host/new")} accessibilityRole="button" accessibilityLabel="New quiz" hitSlop={10}>
              <Plus color={colors.text} size={26} />
            </Pressable>
          ) : undefined,
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          user ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.text}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          ) : undefined
        }
      >
        {!user ? (
          <AuthGate reason="Sign in to write questions and run games from your phone. Everything you type is saved as you go." />
        ) : (
          <>
            {error && <Text style={styles.error}>{error}</Text>}
            {live.length > 0 && (
              <View style={{ gap: space.md }}>
                <SectionTitle>Live now</SectionTitle>
                {live.map((s) => (
                  <Pressable key={s.id} onPress={() => router.push({ pathname: "/run/[sessionId]", params: { sessionId: s.id } })} accessibilityRole="button">
                    <Card tint={colors.primary} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                      <Radio color={colors.text} size={22} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.h2} numberOfLines={1}>{s.quiz_title}</Text>
                        <Text style={styles.small}>Room code {s.room_code} · tap to control</Text>
                      </View>
                      <ChevronRight color={colors.muted} size={20} />
                    </Card>
                  </Pressable>
                ))}
              </View>
            )}

            <SectionTitle>Your quizzes</SectionTitle>
            {quizzes === null ? (
              <Text style={styles.body}>Loading…</Text>
            ) : quizzes.length === 0 ? (
              <Empty
                title="No quizzes yet"
                body="Create your first quiz. Questions save automatically, so you can leave and come back any time."
                action={<Button title="New quiz" onPress={() => router.push("/host/new")} icon={<Plus color={colors.text} size={20} />} />}
              />
            ) : (
              quizzes.map((q) => (
                <Pressable key={q.id} onPress={() => router.push({ pathname: "/host/quiz/[id]", params: { id: q.id } })} accessibilityRole="button" accessibilityLabel={`Open ${q.title}`}>
                  <Card style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                      <Text style={[styles.h2, { flex: 1 }]} numberOfLines={1}>{q.title}</Text>
                      <ChevronRight color={colors.muted} size={20} />
                    </View>
                    <View style={styles.row}>
                      <Pill tone="primary">{GAME_MODE_INFO[q.mode].name}</Pill>
                      <Pill tone={q.status === "ready" ? "good" : "neutral"}>{q.status === "ready" ? "Ready" : "Draft"}</Pill>
                      <Text style={styles.small}>{q.questions?.[0]?.count ?? 0} questions</Text>
                    </View>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
