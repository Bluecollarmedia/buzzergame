import { useState } from "react";
import { Text, View } from "react-native";
import { emailSchema, passwordSchema, LIMITS } from "@crowdquiz/shared";
import { Button, Card, Field, styles } from "./ui";
import { useAuth } from "@/lib/auth";
import { feel } from "@/lib/haptics";
import { openPage } from "@/lib/links";
import { colors, space } from "@/lib/theme";

type Mode = "signin" | "signup" | "forgot";

/** Sign in / create account / reset password, for hosts. */
export function AuthGate({ reason }: { reason?: string }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setInfo(null);
    const e = emailSchema.safeParse(email);
    if (!e.success) return fail(e.error.issues[0]?.message ?? "Enter a valid email address");
    if (mode === "signup" && !name.trim()) return fail("Enter your name");
    if (mode !== "forgot") {
      const p = mode === "signup" ? passwordSchema.safeParse(password) : password ? { success: true as const } : null;
      if (!p) return fail("Enter your password");
      if (!p.success) return fail(p.error.issues[0]?.message ?? "Check your password");
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else if (mode === "signup") {
        const r = await signUp(name, email, password);
        if (r.needsEmailConfirmation) {
          setInfo("Check your email and tap the link to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        await resetPassword(email);
        setInfo("If an account exists for that email, a reset link is on its way.");
        setMode("signin");
      }
      feel.right();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const fail = (m: string) => {
    feel.wrong();
    setError(m);
  };

  return (
    <View style={{ gap: space.lg }}>
      {reason ? <Text style={styles.body}>{reason}</Text> : null}
      <Card style={{ gap: space.lg }}>
        <Text style={styles.h2}>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password"}</Text>
        {mode === "signup" && (
          <Field label="Your name" value={name} onChangeText={setName} maxLength={LIMITS.hostDisplayName} autoComplete="name" textContentType="name" />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        {mode !== "forgot" && (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            textContentType={mode === "signup" ? "newPassword" : "password"}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        )}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {info ? <Text style={[styles.body, { color: colors.good }]}>{info}</Text> : null}
        <Button title={mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"} onPress={submit} loading={busy} />
        {mode === "signin" && <Button title="Forgot your password?" variant="ghost" small onPress={() => { setMode("forgot"); setError(null); }} />}
        <Button
          title={mode === "signup" ? "I already have an account" : mode === "forgot" ? "Back to sign in" : "Create an account"}
          variant="glass"
          small
          onPress={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        />
      </Card>
      <Text style={[styles.small, { textAlign: "center", lineHeight: 19 }]}>
        By continuing you agree to the{" "}
        <Text style={{ color: colors.primary }} onPress={() => openPage("terms")}>Terms</Text> and{" "}
        <Text style={{ color: colors.primary }} onPress={() => openPage("privacy")}>Privacy Policy</Text>.
      </Text>
    </View>
  );
}
