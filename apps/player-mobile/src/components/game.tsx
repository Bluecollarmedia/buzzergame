import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Check, X } from "lucide-react-native";
import { ANSWER_COLORS, colors, radius, space } from "@/lib/theme";
import { Glass } from "./glass";

/** Circular countdown. Turns red and throbs in the last seconds. */
export function TimerRing({ remainingMs, totalMs, size = 96 }: { remainingMs: number | null; totalMs: number; size?: number }) {
  const secs = remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000));
  const frac = remainingMs === null || totalMs <= 0 ? 1 : Math.max(0, Math.min(1, remainingMs / totalMs));
  const urgent = remainingMs !== null && remainingMs <= 5000;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const throb = useSharedValue(1);
  useEffect(() => {
    if (urgent) {
      throb.value = withRepeat(withSequence(withTiming(1.08, { duration: 220 }), withTiming(1, { duration: 220 })), -1);
    } else {
      cancelAnimation(throb);
      throb.value = withTiming(1, { duration: 150 });
    }
  }, [urgent, throb]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: throb.value }] }));
  const color = urgent ? colors.bad : colors.text;
  return (
    <Animated.View
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, anim]}
      accessibilityRole="timer"
      accessibilityLabel={secs === null ? "Timer" : `${secs} seconds left`}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={{ color, fontSize: size * 0.4, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{secs ?? ""}</Text>
    </Animated.View>
  );
}

/**
 * A red glow around the screen edge that beats faster as time runs out. It is
 * the visual partner of the countdown buzz.
 */
export function UrgencyGlow({ remainingMs }: { remainingMs: number | null }) {
  const o = useSharedValue(0);
  const on = remainingMs !== null && remainingMs > 0 && remainingMs <= 6000;
  const period = remainingMs === null ? 1000 : Math.max(220, Math.min(1000, remainingMs / 5));
  useEffect(() => {
    if (!on) {
      cancelAnimation(o);
      o.value = withTiming(0, { duration: 200 });
      return;
    }
    const strength = remainingMs! <= 2000 ? 0.85 : remainingMs! <= 4000 ? 0.6 : 0.35;
    o.value = withRepeat(
      withSequence(withTiming(strength, { duration: period / 2, easing: Easing.out(Easing.quad) }), withTiming(0.08, { duration: period / 2 })),
      -1,
    );
    // Restart the beat only when the tempo band changes.
  }, [on, Math.round(period / 60)]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[styles.glow, style]} />;
}

/** One big answer button. Reacts the instant the finger lands. */
export function AnswerButton({
  index, text, showName, enabled, chosen, resultIcon, instant, onPress,
}: {
  index: number;
  text?: string | null;
  showName?: boolean;
  enabled: boolean;
  chosen: boolean;
  resultIcon?: "correct" | "wrong" | "locked" | null;
  /** Fire on touch-down (buzzer races). Otherwise fire on release, so a slip of the finger can be dragged off. */
  instant?: boolean;
  onPress: () => void;
}) {
  const c = ANSWER_COLORS[index]!;
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.answerWrap, anim, !enabled && !chosen && { opacity: 0.35 }]}>
      <Pressable
        disabled={!enabled}
        onPressIn={() => {
          scale.value = withSpring(0.94, { damping: 16, stiffness: 500 });
          if (instant) onPress();
        }}
        onPress={instant ? undefined : onPress}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12, stiffness: 260 });
        }}
        accessibilityRole="button"
        accessibilityLabel={`${c.name} ${c.label}${text ? `: ${text}` : ""}`}
        accessibilityState={{ disabled: !enabled, selected: chosen }}
        style={{ flex: 1 }}
      >
        <Glass tint={chosen ? c.bgPressed : c.bg} interactive={enabled} radiusSize={radius.xl} style={[styles.answer, chosen && styles.answerChosen]}>
          <Text style={styles.answerLetter}>{c.label}</Text>
          {text ? (
            <Text style={styles.answerText} numberOfLines={3}>
              {text}
            </Text>
          ) : null}
          {showName ? <Text style={styles.answerName}>{c.name}</Text> : null}
          {resultIcon ? (
            <View style={styles.badge}>
              {resultIcon === "correct" ? <Check color="white" size={18} /> : resultIcon === "wrong" ? <X color="white" size={18} /> : <LockDot />}
            </View>
          ) : null}
        </Glass>
      </Pressable>
    </Animated.View>
  );
}

function LockDot() {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "white" }} />;
}

/** Big round result mark that pops in. */
export function ResultBadge({ kind }: { kind: "correct" | "wrong" | "none" | "trophy" }) {
  const s = useSharedValue(0.3);
  useEffect(() => {
    s.value = withSpring(1, { damping: 9, stiffness: 140 });
  }, [s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const bg = kind === "correct" ? colors.good : kind === "wrong" ? colors.bad : kind === "trophy" ? colors.gold : "rgba(255,255,255,0.2)";
  return (
    <Animated.View style={anim}>
      <Glass tint={bg} radiusSize={999} style={{ width: 112, height: 112, alignItems: "center", justifyContent: "center" }}>
        {kind === "correct" || kind === "trophy" ? <Check color="white" size={56} strokeWidth={3} /> : kind === "wrong" ? <X color="white" size={56} strokeWidth={3} /> : <Text style={{ color: "white", fontSize: 40 }}>–</Text>}
      </Glass>
    </Animated.View>
  );
}

/** A number that pops each time it changes (the 3-2-1). */
export function PopNumber({ value }: { value: string }) {
  const s = useSharedValue(1.6);
  const o = useSharedValue(0);
  useEffect(() => {
    s.value = 1.6;
    o.value = 0;
    s.value = withSpring(1, { damping: 11, stiffness: 180 });
    o.value = withTiming(1, { duration: 140 });
  }, [value, s, o]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: o.value }));
  return <Animated.Text style={[styles.pop, anim]}>{value}</Animated.Text>;
}

const styles = StyleSheet.create({
  glow: {
    ...StyleSheet.absoluteFill,
    borderWidth: 6,
    borderColor: colors.danger,
    borderRadius: 38,
    shadowColor: colors.danger,
    shadowOpacity: 1,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
  },
  answerWrap: { width: "48.5%", flexGrow: 1, flexBasis: "46%", minHeight: 130 },
  answer: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.md },
  answerChosen: { borderWidth: 3, borderColor: "rgba(255,255,255,0.95)" },
  answerLetter: { color: "white", fontSize: 54, fontWeight: "900" },
  answerText: { color: "white", fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: 4 },
  answerName: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "700", marginTop: 2 },
  badge: { position: "absolute", top: 12, right: 12, backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 999, padding: 5 },
  pop: { color: colors.text, fontSize: 140, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
