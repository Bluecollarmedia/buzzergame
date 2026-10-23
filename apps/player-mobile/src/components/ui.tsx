import { useEffect, type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withRepeat, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { feel } from "@/lib/haptics";
import { colors, font, radius, space } from "@/lib/theme";
import { Backdrop, Glass, hasLiquidGlass } from "./glass";

/** A full screen with the Buzzavid backdrop. */
export function Screen({ children, style, edges }: { children?: ReactNode; style?: StyleProp<ViewStyle>; edges?: ("top" | "bottom" | "left" | "right")[] }) {
  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView edges={edges ?? ["top", "bottom"]} style={[styles.safe, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

/**
 * Scrolling content that sits under a native, glass navigation bar or tab bar.
 * The system adds the right insets itself, so nothing is hidden behind them.
 */
export function Page({ children, style, contentStyle }: { children: ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.root, style]}>
      <Backdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.pageContent, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function Spacer({ h = space.lg }: { h?: number }) {
  return <View style={{ height: h }} />;
}

type ButtonVariant = "primary" | "glass" | "danger" | "ghost";

export function Button({
  title, onPress, loading, disabled, variant = "primary", icon, small, style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  icon?: ReactNode;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tint = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : undefined;
  const label = (
    <View style={styles.row}>
      {loading ? <ActivityIndicator color={colors.text} /> : icon}
      <Text style={[styles.buttonText, small && { fontSize: 15 }, variant === "ghost" && { color: colors.muted }]}>{title}</Text>
    </View>
  );
  return (
    <Animated.View style={[anim, off && { opacity: 0.45 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPressIn={() => {
          scale.value = withSpring(0.96, { damping: 18, stiffness: 400 });
          feel.tap();
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 14, stiffness: 300 });
        }}
        onPress={onPress}
      >
        {variant === "ghost" ? (
          <View style={[styles.buttonBase, small && styles.buttonSmall]}>{label}</View>
        ) : hasLiquidGlass ? (
          <Glass tint={tint} interactive radiusSize={radius.pill} style={[styles.buttonBase, small && styles.buttonSmall]}>
            {label}
          </Glass>
        ) : (
          <Glass tint={tint ? tint : undefined} radiusSize={radius.pill} style={[styles.buttonBase, small && styles.buttonSmall]}>
            {label}
          </Glass>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** A glass card. */
export function Card({ children, style, tint }: { children: ReactNode; style?: StyleProp<ViewStyle>; tint?: string }) {
  return (
    <Glass tint={tint} radiusSize={radius.lg} style={[{ padding: space.lg }, style]}>
      {children}
    </Glass>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.primary}
        keyboardAppearance="dark"
        {...props}
        style={[styles.input, props.multiline && { minHeight: 96, paddingTop: 14, textAlignVertical: "top" }, props.style]}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A native switch. On iOS 26 the system draws it with Liquid Glass; nothing
 * custom is needed.
 */
export function Toggle({ label, hint, value, onValueChange }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.small}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          feel.select();
          onValueChange(v);
        }}
        trackColor={{ true: colors.primary, false: "rgba(255,255,255,0.18)" }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "primary" }) {
  const bg = tone === "good" ? "rgba(52,211,153,0.2)" : tone === "warn" ? "rgba(251,191,36,0.2)" : tone === "primary" ? colors.primarySoft : colors.glass;
  const fg = tone === "good" ? colors.good : tone === "warn" ? colors.warn : tone === "primary" ? "#C9BDFF" : colors.muted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={[styles.body, { textAlign: "center" }]}>{body}</Text>
      {action}
    </View>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Buzzavid">
      <Glass tint={colors.primary} radiusSize={size * 0.32} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: size * 0.56 }}>B</Text>
      </Glass>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: size * 0.58, letterSpacing: -0.3 }}>Buzzavid</Text>
    </View>
  );
}

/** A soft pulsing dot, used for "waiting" states. */
export function PulseDot({ color = colors.good, size = 10 }: { color?: string; size?: number }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.3, { duration: 800 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.stage },
  safe: { flex: 1, paddingHorizontal: space.xl },
  pageContent: { paddingHorizontal: space.xl, paddingBottom: 48, gap: space.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  buttonBase: { minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.lg },
  buttonText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  title: { ...font.title, color: colors.text },
  h1: { ...font.h1, color: colors.text },
  h2: { ...font.h2, color: colors.text },
  big: { color: colors.text, fontSize: 30, fontWeight: "800", textAlign: "center" },
  body: { ...font.body, color: colors.muted },
  small: { ...font.small, color: colors.subtle },
  label: { ...font.label, color: colors.subtle },
  fieldLabel: { ...font.small, color: colors.muted, fontWeight: "600" },
  input: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    color: colors.text,
    paddingHorizontal: space.lg,
    fontSize: 18,
    fontWeight: "500",
  },
  error: { color: "#FDA4AF", fontSize: 14, fontWeight: "500" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 },
  toggleLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  pillText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  sectionTitle: { ...font.label, color: colors.subtle, marginTop: space.sm },
  empty: { alignItems: "center", gap: space.md, paddingVertical: 48, paddingHorizontal: space.xl },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
});
