import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Share, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { errorMessage, type AdminAccessCode, type AdminHost, type AdminSession, type AppSettings } from "@crowdquiz/shared";
import { Glass } from "@/components/glass";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, Empty, Field, Page, Pill, SectionTitle, styles } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { feel } from "@/lib/haptics";
import { getApi } from "@/lib/supabase";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { colors, radius, space } from "@/lib/theme";

type Section = "codes" | "hosts" | "games";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "codes", label: "Codes" },
  { key: "hosts", label: "Hosts" },
  { key: "games", label: "Live games" },
];
const DURATIONS = [
  { label: "1 day", hours: 24 },
  { label: "1 week", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "90 days", hours: 24 * 90 },
];
const USES = [1, 5, 25, 100];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

/** Admin: make access codes, manage hosts and end live games. Only admin accounts ever see this tab. */
export default function Admin() {
  const { user, ready } = useAuth();
  const isAdmin = useIsAdmin();
  const [section, setSection] = useState<Section>("codes");

  return (
    <Page>
      {ready && !user && <AuthGate reason="Sign in with your admin account." />}
      {user && !isAdmin && <Empty title="Admins only" body="This account isn't an admin." />}
      {user && isAdmin && (
        <>
          <Switches />
          <View style={[styles.row, { gap: space.sm }]}>
            {SECTIONS.map((s) => (
              <Pressable key={s.key} onPress={() => { feel.tap(); setSection(s.key); }} style={{ flex: 1 }} accessibilityRole="tab" accessibilityState={{ selected: section === s.key }}>
                <Glass tint={section === s.key ? colors.primary : undefined} radiusSize={radius.pill} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{s.label}</Text>
                </Glass>
              </Pressable>
            ))}
          </View>
          {section === "codes" && <Codes />}
          {section === "hosts" && <Hosts />}
          {section === "games" && <Games />}
        </>
      )}
    </Page>
  );
}

type SwitchKey = "freeHosting" | "photoUploads";
const SWITCHES: { key: SwitchKey; title: string; on: string; off: string }[] = [
  {
    key: "freeHosting",
    title: "Free hosting",
    on: "Anyone signed in can host games without an access code.",
    off: "Hosting needs an access code or a grant from you.",
  },
  {
    key: "photoUploads",
    title: "Photo uploads",
    on: "Hosts can add photos to questions.",
    off: "Nobody can upload new photos. Photos already on quizzes still show.",
  },
];

/** App-wide on/off switches. Changes apply to everyone straight away. */
function Switches() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState<SwitchKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await getApi().admin.getSettings());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const flip = async (key: SwitchKey, on: boolean) => {
    feel.tap();
    setBusy(key);
    setError(null);
    try {
      setSettings(await getApi().admin.updateSettings({ [key]: on }));
    } catch (e) {
      setError(errorMessage(e));
      feel.wrong();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionTitle>Switches</SectionTitle>
      <Card style={{ gap: space.md }}>
        {SWITCHES.map((sw) => {
          const on = settings ? settings[sw.key] : false;
          return (
            <View key={sw.key} style={[styles.row, { gap: space.md, alignItems: "center" }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>{sw.title}</Text>
                <Text style={styles.small}>{settings ? (on ? sw.on : sw.off) : "Loading…"}</Text>
              </View>
              <Switch
                value={on}
                disabled={!settings || busy !== null}
                onValueChange={(v) => void flip(sw.key, v)}
                trackColor={{ true: colors.good }}
                accessibilityLabel={sw.title}
              />
            </View>
          );
        })}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      </Card>
    </>
  );
}

function Chips<T extends string | number>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => (
        <Pressable key={String(o.value)} onPress={() => { feel.tap(); onChange(o.value); }} accessibilityRole="button" accessibilityState={{ selected: o.value === value }}>
          <Glass tint={o.value === value ? colors.primary : undefined} radiusSize={radius.pill} style={{ paddingHorizontal: 16, minHeight: 40, justifyContent: "center" }}>
            <Text style={{ color: colors.text, fontWeight: "600" }}>{o.label}</Text>
          </Glass>
        </Pressable>
      ))}
    </View>
  );
}

function Codes() {
  const [hours, setHours] = useState(24 * 7);
  const [uses, setUses] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [codes, setCodes] = useState<AdminAccessCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCodes(await getApi().admin.listAccessCodes());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getApi().admin.createAccessCode({ durationHours: hours, maxRedemptions: uses, expiresAt: null, note: note.trim() || null });
      setFresh(r.code);
      setNote("");
      feel.right();
      await load();
    } catch (e) {
      setError(errorMessage(e));
      feel.wrong();
    } finally {
      setBusy(false);
    }
  };

  const revoke = (c: AdminAccessCode) =>
    Alert.alert("Revoke this code?", `${c.hint}… will stop working. People who already used it keep their access.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => { try { await getApi().admin.revokeAccessCode(c.id); await load(); } catch (e) { setError(errorMessage(e)); } } },
    ]);

  return (
    <>
      <SectionTitle>New access code</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Text style={styles.fieldLabel}>Access lasts</Text>
        <Chips options={DURATIONS.map((d) => ({ label: d.label, value: d.hours }))} value={hours} onChange={setHours} />
        <Text style={styles.fieldLabel}>Number of people who can use it</Text>
        <Chips options={USES.map((n) => ({ label: String(n), value: n }))} value={uses} onChange={setUses} />
        <Field label="Note (only you see this)" value={note} onChangeText={setNote} placeholder="Who is it for?" maxLength={200} />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Create code" onPress={create} loading={busy} />
      </Card>

      {fresh ? (
        <Card tint={colors.good} style={{ gap: space.sm }}>
          <Text style={styles.small}>Copy it now. It is shown only once.</Text>
          <Text selectable style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: 1 }}>{fresh}</Text>
          <Button title="Share" variant="glass" small onPress={() => void Share.share({ message: `Your hosting code: ${fresh}` })} />
          <Text style={styles.small}>People redeem it at the website under Account, then Redeem a code.</Text>
        </Card>
      ) : null}

      <SectionTitle>Codes</SectionTitle>
      {codes && codes.length === 0 ? <Text style={styles.body}>No codes yet.</Text> : null}
      {codes?.map((c) => (
        <Card key={c.id} style={{ gap: 6 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.h2, { fontSize: 18 }]}>{c.hint}…</Text>
            <Pill tone={c.status === "active" ? "good" : c.status === "revoked" ? "warn" : "neutral"}>{c.status}</Pill>
          </View>
          <Text style={styles.body}>
            {Math.round(c.durationHours / 24)} days · used {c.redemptionCount} of {c.maxRedemptions}
            {c.note ? ` · ${c.note}` : ""}
          </Text>
          {c.status === "active" ? <Button title="Revoke" variant="ghost" small onPress={() => revoke(c)} /> : null}
        </Card>
      ))}
    </>
  );
}

function Hosts() {
  const [q, setQ] = useState("");
  const [hosts, setHosts] = useState<AdminHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHosts(await getApi().admin.listHosts(q.trim() || undefined));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      feel.right();
      await load();
    } catch (e) {
      setError(errorMessage(e));
      feel.wrong();
    }
  };
  const grant = (h: AdminHost) =>
    Alert.alert("Give hosting access", h.email, [
      ...DURATIONS.slice(0, 3).map((d) => ({ text: d.label, onPress: () => void act(() => getApi().admin.grantEntitlement(h.id, d.hours)) })),
      { text: "Cancel", style: "cancel" as const },
    ]);

  return (
    <>
      <Field label="Search hosts" value={q} onChangeText={setQ} placeholder="Email or name" autoCapitalize="none" autoCorrect={false} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {hosts && hosts.length === 0 ? <Text style={styles.body}>No hosts found.</Text> : null}
      {hosts?.map((h) => {
        const hasAccess = !!h.accessExpiresAt && new Date(h.accessExpiresAt) > new Date();
        return (
          <Card key={h.id} style={{ gap: 6 }}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.h2, { fontSize: 18, flex: 1 }]} numberOfLines={1}>{h.displayName || h.email}</Text>
              {h.isAdmin ? <Pill tone="primary">admin</Pill> : h.disabled ? <Pill tone="warn">disabled</Pill> : hasAccess ? <Pill tone="good">can host</Pill> : <Pill>no access</Pill>}
            </View>
            <Text style={styles.body} numberOfLines={1}>{h.email}</Text>
            <Text style={styles.small}>
              {h.quizCount} quizzes · {h.sessionCount} games · access until {day(h.accessExpiresAt)}
            </Text>
            {!h.isAdmin ? (
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                <Button title="Give access" variant="glass" small onPress={() => grant(h)} />
                {hasAccess ? <Button title="Remove access" variant="ghost" small onPress={() => void act(() => getApi().admin.revokeEntitlements(h.id))} /> : null}
                <Button
                  title={h.disabled ? "Enable" : "Disable"}
                  variant="ghost"
                  small
                  onPress={() => void act(() => getApi().admin.setHostDisabled(h.id, !h.disabled, h.disabled ? undefined : "Disabled by admin"))}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

function Games() {
  const [games, setGames] = useState<AdminSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setGames(await getApi().admin.listSessions(true));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const end = (g: AdminSession) =>
    Alert.alert("End this game?", `${g.title} by ${g.hostEmail} will stop for everyone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "End game", style: "destructive", onPress: async () => { try { await getApi().admin.endSession(g.id); await load(); } catch (e) { setError(errorMessage(e)); } } },
    ]);

  return (
    <>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {games && games.length === 0 ? <Empty title="No live games" body="Games in progress show up here." /> : null}
      {games?.map((g) => (
        <Card key={g.id} style={{ gap: 6 }}>
          <Text style={[styles.h2, { fontSize: 18 }]} numberOfLines={1}>{g.title}</Text>
          <Text style={styles.body} numberOfLines={1}>{g.hostEmail}</Text>
          <Text style={styles.small}>{g.status.replace(/_/g, " ")} · {g.playerCount} players</Text>
          <Button title="End game" variant="danger" small onPress={() => end(g)} />
        </Card>
      ))}
    </>
  );
}
