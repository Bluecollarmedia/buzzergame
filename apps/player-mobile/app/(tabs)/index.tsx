import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { QrCode } from "lucide-react-native";
import { errorMessage, normalizeRoomCode } from "@crowdquiz/shared";
import { Backdrop } from "@/components/glass";
import { Button, Card, Field, Logo, styles } from "@/components/ui";
import { isConfigured } from "@/lib/config";
import { APP_TAGLINE } from "@/lib/brand";
import { getApi } from "@/lib/supabase";
import { colors, space } from "@/lib/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Play: scan the QR code on the big screen or type the room code. */
export default function Play() {
  const insets = useSafeAreaInsets();
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
    <View style={styles.root}>
      <Backdrop />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + space.xl, paddingHorizontal: space.xl, paddingBottom: 140, gap: space.xl }}
          showsVerticalScrollIndicator={false}
        >
          <Logo size={40} />
          <View style={{ gap: 6, marginTop: space.xl }}>
            <Text style={styles.title}>Join a game</Text>
            <Text style={styles.body}>{APP_TAGLINE} Scan the code on the big screen to get in.</Text>
          </View>

          {!isConfigured && (
            <Text style={styles.error} accessibilityRole="alert">
              This build is missing its server settings.
            </Text>
          )}

          <Button title="Scan QR code" onPress={() => router.push("/scan")} icon={<QrCode color={colors.text} size={24} />} />

          <Card style={{ gap: space.md }}>
            <Text style={styles.label}>Or type the room code</Text>
            <Field
              label="Room code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="ABC 123"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={submit}
              error={error}
              style={{ textAlign: "center", fontSize: 30, letterSpacing: 6, fontVariant: ["tabular-nums"], fontWeight: "800" }}
            />
            <Button title="Join" variant="glass" onPress={submit} loading={busy} />
          </Card>

          <Text style={[styles.small, { textAlign: "center" }]}>No account needed to play.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
