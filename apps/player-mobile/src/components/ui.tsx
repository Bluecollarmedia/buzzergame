import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";

export function Screen({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <SafeAreaView style={[styles.screen, style]}>{children}</SafeAreaView>;
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        (pressed || off) && { opacity: off ? 0.5 : 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.buttonText, variant === "ghost" && { color: colors.muted, fontWeight: "500" }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function Logo() {
  return (
    <View style={styles.row} accessibilityRole="header">
      <View style={styles.logoMark}>
        <Text style={styles.logoQ}>Q</Text>
      </View>
      <Text style={styles.logoText}>CrowdQuiz</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.stage, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { minHeight: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: "transparent", minHeight: 44 },
  buttonText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  logoMark: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  logoQ: { color: colors.text, fontWeight: "800", fontSize: 16 },
  logoText: { color: colors.text, fontWeight: "700", fontSize: 18 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "700" },
  big: { color: colors.text, fontSize: 30, fontWeight: "800", textAlign: "center" },
  body: { color: colors.muted, fontSize: 16, textAlign: "center" },
  label: { color: colors.subtle, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600" },
  input: {
    height: 60,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: 16,
    fontSize: 20,
  },
  error: { color: "#FCA5A5", fontSize: 15 },
});
