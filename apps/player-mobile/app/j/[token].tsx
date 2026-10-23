import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  LIMITS, errorMessage, generatePlayerSecret, isJoinToken, normalizeDisplayName, toAppError, type JoinInfo,
} from "@crowdquiz/shared";
import { Button, Center, Field, Logo, PulseDot, Screen, styles } from "@/components/ui";
import { PlayerGame } from "@/components/PlayerGame";
import { getApi } from "@/lib/supabase";
import { clearPlayer, loadPlayer, savePlayer, type StoredPlayer } from "@/lib/storage";
import { colors } from "@/lib/theme";
import { feel } from "@/lib/haptics";

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

/**
 * Opened from a scanned QR code, a universal / app link
 * (https://<site>/j/<token>) or the crowdquiz://j/<token> scheme.
 */
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const joinToken = typeof token === "string" ? token : "";
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const resolve = useCallback(async (): Promise<Phase> => {
    if (!isJoinToken(joinToken)) return { kind: "error", message: "That game link isn't valid." };
    try {
      const api = getApi();
      const info = await api.getJoinInfo(joinToken);
      const saved = await loadPlayer(joinToken);
      if (saved && saved.sessionId === info.sessionId && saved.participantId) {
        try {
          await api.playerState(info.sessionId, saved.secret);
          return { kind: "play", player: saved };
        } catch (e) {
          const code = toAppError(e).code;
          if (code === "player_removed") return { kind: "error", message: errorMessage(e) };
          if (code !== "invalid_player") throw e;
          await clearPlayer(joinToken);
        }
      }
      if (!info.joinable) {
        return { kind: "closed", info, message: REASONS[info.reason ?? ""] ?? "This game isn't accepting players." };
      }
      return { kind: "name", info };
    } catch (e) {
      return { kind: "error", message: errorMessage(e) };
    }
  }, [joinToken]);

  useEffect(() => {
    let live = true;
    void resolve().then((p) => live && setPhase(p));
    return () => {
      live = false;
    };
  }, [resolve]);

  const retry = () => {
    setPhase({ kind: "loading" });
    void resolve().then(setPhase);
  };
  const home = () => router.replace("/");

  if (phase.kind === "play") {
    return (
      <PlayerGame
        sessionId={phase.player.sessionId}
        secret={phase.player.secret}
        onLeave={() => {
          void clearPlayer(joinToken).then(home);
        }}
      />
    );
  }

  return (
    <Screen>
      <View style={{ paddingTop: 12 }}>
        <Logo />
      </View>
      {phase.kind === "loading" && (
        <Center>
          <PulseDot color={colors.primary} size={14} />
          <Text style={[styles.body, { marginTop: 14 }]} accessibilityRole="progressbar">
            Finding the game…
          </Text>
        </Center>
      )}
      {phase.kind === "error" && (
        <Center>
          <Text style={styles.big}>{phase.message}</Text>
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: 24 }}>
            <Button title="Try again" onPress={retry} />
            <Button title="Enter a room code instead" variant="ghost" onPress={home} />
          </View>
        </Center>
      )}
      {phase.kind === "closed" && (
        <Center>
          <Text style={styles.label}>{phase.info.title}</Text>
          <Text style={[styles.big, { marginTop: 8 }]}>{phase.message}</Text>
          <View style={{ alignSelf: "stretch", marginTop: 24 }}>
            <Button title="Back" variant="glass" onPress={home} />
          </View>
        </Center>
      )}
      {phase.kind === "name" && (
        <NameForm
          info={phase.info}
          onJoin={async (name) => {
            // Keep one secret across retries so a repeated tap never makes a second player.
            const existing = await loadPlayer(joinToken);
            const secret = existing?.sessionId === phase.info.sessionId ? existing.secret : generatePlayerSecret();
            await savePlayer(joinToken, { sessionId: phase.info.sessionId, secret, savedAt: Date.now() });
            const r = await getApi().join(joinToken, name, secret);
            const player: StoredPlayer = {
              sessionId: r.sessionId,
              secret,
              participantId: r.participantId,
              displayName: r.displayName,
              savedAt: Date.now(),
            };
            await savePlayer(joinToken, player);
            setPhase({ kind: "play", player });
          }}
        />
      )}
    </Screen>
  );
}

function NameForm({ info, onJoin }: { info: JoinInfo; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = normalizeDisplayName(name);
    if (!n.ok) {
      feel.wrong();
      return setError(n.error);
    }
    setBusy(true);
    setError(null);
    try {
      await onJoin(n.name);
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, justifyContent: "center", gap: 16 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.label}>You&apos;re joining</Text>
      <Text style={styles.title}>{info.title}</Text>
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="Enter your name"
        maxLength={LIMITS.displayName}
        autoFocus
        autoComplete="nickname"
        textContentType="nickname"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={error}
      />
      <Button title="Join game" onPress={submit} loading={busy} />
      <Text style={[styles.small, { textAlign: "center" }]}>No account needed. Your name is only shown in this game.</Text>
    </KeyboardAvoidingView>
  );
}
