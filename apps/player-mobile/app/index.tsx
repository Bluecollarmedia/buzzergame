import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { QrCode } from "lucide-react-native";
import { errorMessage, normalizeRoomCode } from "@crowdquiz/shared";
import { Button, Logo, Screen, styles } from "@/components/ui";
import { getApi } from "@/lib/supabase";
import { isConfigured } from "@/lib/config";
import { colors } from "@/lib/theme";

/** Home: scan the QR code or type the room code. */
export default function Home() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const c = normalizeRoomCode(code);
    if (c.length !== 6) return setError("Room codes have 6 letters and numbers.");
    setBusy(true);
    setError(null);
    try {
      const r = await getApi().resolveRoomCode(c);
      setCode("");
      router.push({ pathname: "/j/[token]", params: { token: r.joinToken } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingTop: 12 }}>
          <Logo />
        </View>
        <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
          {!isConfigured && (
            <Text style={styles.error} accessibilityRole="alert">
              This build is missing its server settings (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY).
            </Text>
          )}
          <Text style={styles.h1}>Join a game</Text>
          <Text style={[styles.body, { textAlign: "left" }]}>Scan the QR code on the big screen, or type the room code.</Text>
          <Button title="Scan QR code" onPress={() => router.push("/scan")} icon={<QrCode color={colors.text} size={22} />} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.subtle }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>
          <TextInput
            accessibilityLabel="Room code"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="ABC 123"
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="go"
            onSubmitEditing={submit}
            style={[styles.input, { textAlign: "center", fontSize: 30, letterSpacing: 6, fontVariant: ["tabular-nums"] }]}
          />
          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button title="Continue" variant="secondary" onPress={submit} loading={busy} />
        </View>
        <Text style={[styles.body, { fontSize: 13, color: colors.subtle, paddingBottom: 8 }]}>No account needed.</Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}
