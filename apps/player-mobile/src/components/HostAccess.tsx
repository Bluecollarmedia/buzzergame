import { useState } from "react";
import { Text, View } from "react-native";
import { KeyRound, MessageCircle } from "lucide-react-native";
import { errorMessage } from "@crowdquiz/shared";
import { Button, Card, Field, styles } from "@/components/ui";
import { feel } from "@/lib/haptics";
import { messageOnWhatsApp } from "@/lib/links";
import { getApi } from "@/lib/supabase";
import { colors, space } from "@/lib/theme";

export type Redeemed = { startsAt: string; expiresAt: string; startsLater: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Text for a redeemed code: when hosting is open until, or when it starts. */
export function redeemedText(r: Redeemed) {
  return r.startsLater
    ? `Your new access starts when your current access ends, on ${when(r.startsAt)}, and lasts until ${when(r.expiresAt)}.`
    : `You can host games until ${when(r.expiresAt)}.`;
}

/**
 * Where a host gets hosting access: type an access code, or message the owner
 * on WhatsApp to get one. Shown right where "Start a game" fails, and under
 * Account.
 */
export function HostAccess({ title, intro, onRedeemed }: { title?: string; intro?: string; onRedeemed?: (r: Redeemed) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Redeemed | null>(null);

  const redeem = async () => {
    if (!code.trim()) return setError("Enter your access code.");
    setBusy(true);
    setError(null);
    try {
      const r = await getApi().redeemAccessCode(code.trim());
      const result = { startsAt: r.startsAt, expiresAt: r.expiresAt, startsLater: Date.parse(r.startsAt) > Date.now() + 60_000 };
      setDone(result);
      setCode("");
      feel.right();
      onRedeemed?.(result);
    } catch (e) {
      setError(errorMessage(e));
      feel.wrong();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      {title ? <Text style={styles.h2}>{title}</Text> : null}
      {intro ? <Text style={styles.body}>{intro}</Text> : null}
      {done ? (
        <Text style={[styles.body, { color: colors.good }]} accessibilityRole="alert">
          Code accepted. {redeemedText(done)}
        </Text>
      ) : (
        <>
          <Field
            label="Access code"
            value={code}
            onChangeText={(t) => {
              setCode(t);
              if (error) setError(null);
            }}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="go"
            onSubmitEditing={() => void redeem()}
            error={error}
            style={{ fontFamily: "Menlo", letterSpacing: 1.5 }}
          />
          <Button title="Unlock hosting" onPress={() => void redeem()} loading={busy} icon={<KeyRound color={colors.text} size={18} />} />
        </>
      )}
      <View style={{ gap: space.sm }}>
        <Text style={styles.small}>{done ? "Need more time?" : "No code yet? Message us and we'll send you one."}</Text>
        <Button
          title="Message me on WhatsApp"
          variant="glass"
          onPress={() => void messageOnWhatsApp()}
          icon={<MessageCircle color="#25D366" size={20} />}
        />
      </View>
    </Card>
  );
}
