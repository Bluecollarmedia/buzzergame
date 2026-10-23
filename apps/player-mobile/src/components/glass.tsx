import { useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { colors, radius } from "@/lib/theme";

/** True on iPhones running iOS 26 or newer, where Apple's Liquid Glass exists. */
export const hasLiquidGlass = Platform.OS === "ios" && safe(isLiquidGlassAvailable);
function safe(fn: () => boolean) {
  try {
    return fn();
  } catch {
    return false;
  }
}

/**
 * A pane of glass.
 *
 * On iOS 26+ this is Apple's own Liquid Glass (UIGlassEffect). On older iPhones
 * it is Apple's system blur material, and on Android a translucent surface, so
 * the layout stays the same everywhere.
 */
export function Glass({
  children,
  style,
  tint,
  interactive,
  clear,
  radiusSize = radius.lg,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: string;
  interactive?: boolean;
  clear?: boolean;
  radiusSize?: number;
}) {
  const base = useMemo<ViewStyle>(() => ({ borderRadius: radiusSize, overflow: "hidden" }), [radiusSize]);
  if (hasLiquidGlass) {
    return (
      <GlassView
        glassEffectStyle={clear ? "clear" : "regular"}
        tintColor={tint}
        isInteractive={interactive}
        colorScheme="dark"
        style={[base, style]}
      >
        {children}
      </GlassView>
    );
  }
  if (Platform.OS === "ios") {
    return (
      <BlurView intensity={45} tint="systemThinMaterialDark" style={[base, styles.hairline, style]}>
        {tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.55 }]} /> : null}
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[base, styles.hairline, { backgroundColor: tint ?? colors.glassStrong }, style]}>{children}</View>
  );
}

/** The dark, softly glowing background behind every screen. */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#0B1024", "#080B18", "#05060D"]} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="glowA" cx="85%" cy="8%" rx="70%" ry="45%" fx="85%" fy="8%">
            <Stop offset="0" stopColor="#7C5CFF" stopOpacity="0.5" />
            <Stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="glowB" cx="5%" cy="78%" rx="70%" ry="45%" fx="5%" fy="78%">
            <Stop offset="0" stopColor="#FF4FA3" stopOpacity="0.32" />
            <Stop offset="1" stopColor="#FF4FA3" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#glowA)" />
        <Rect width="100%" height="100%" fill="url(#glowB)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  hairline: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
