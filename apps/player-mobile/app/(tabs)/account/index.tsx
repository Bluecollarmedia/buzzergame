import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, Page, SectionTitle, Toggle, styles } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { useAuth } from "@/lib/auth";
import { setHapticsEnabled, useHapticsEnabled, feel } from "@/lib/haptics";
import { emailSupport, openPage } from "@/lib/links";
import { colors, space } from "@/lib/theme";
import Constants from "expo-constants";

/** Account: sign in/out, buzz settings, legal links and account deletion. */
export default function Account() {
  const { user, ready, signOut, deleteAccount } = useAuth();
  const haptics = useHapticsEnabled();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = () =>
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account, your quizzes and photos, and your game history. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () =>
            Alert.alert("Are you absolutely sure?", "Everything you've created in Buzzavid will be gone for good.", [
              { text: "Keep my account", style: "cancel" },
              {
                text: "Yes, delete everything",
                style: "destructive",
                onPress: async () => {
                  setDeleting(true);
                  setError(null);
                  try {
                    await deleteAccount();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't delete your account. Try again.");
                  } finally {
                    setDeleting(false);
                  }
                },
              },
            ]),
        },
      ],
    );

  return (
    <Page>
      {ready && !user && <AuthGate reason="Sign in to write questions and host games. You don't need an account to play." />}

      {user && (
        <Card style={{ gap: 4 }}>
          <Text style={styles.small}>Signed in as</Text>
          <Text style={styles.h2}>{(user.user_metadata?.display_name as string | undefined) || user.email}</Text>
          <Text style={styles.body}>{user.email}</Text>
        </Card>
      )}

      <SectionTitle>Playing</SectionTitle>
      <Card style={{ gap: 4 }}>
        <Toggle
          label="Vibration"
          hint="Taps and a buzz that builds as the timer runs out."
          value={haptics}
          onValueChange={(v) => {
            setHapticsEnabled(v);
            if (v) setTimeout(feel.go, 100);
          }}
        />
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Button title="Privacy Policy" variant="ghost" onPress={() => openPage("privacy")} />
        <Button title="Terms of Use" variant="ghost" onPress={() => openPage("terms")} />
        <Button title="Support" variant="ghost" onPress={() => emailSupport("Buzzavid support")} />
        <Button title="Report a problem or a player" variant="ghost" onPress={() => emailSupport("Buzzavid report")} />
      </Card>

      {user && (
        <>
          <SectionTitle>Account</SectionTitle>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <View style={{ gap: space.md }}>
            <Button title="Sign out" variant="glass" onPress={() => void signOut()} />
            <Button title="Delete account" variant="danger" onPress={confirmDelete} loading={deleting} />
          </View>
        </>
      )}

      <Text style={[styles.small, { textAlign: "center", color: colors.subtle }]}>
        {APP_NAME} {Constants.expoConfig?.version ?? ""}
      </Text>
    </Page>
  );
}
