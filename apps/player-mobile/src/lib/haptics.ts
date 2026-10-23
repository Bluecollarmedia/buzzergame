import { useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import {
  countdownHapticPlan, dueHapticBeats, getReadyHapticBeats, type HapticBeat, type PulseKind, type ServerClock,
} from "@crowdquiz/shared";

/** Whether haptics are on. Players can turn them off in Settings. */
let enabled = true;
const listeners = new Set<(v: boolean) => void>();
const KEY = "bz.haptics";

void SecureStore.getItemAsync(KEY).then((v) => {
  if (v === "off") setHapticsEnabled(false, false);
}).catch(() => {});

export function setHapticsEnabled(v: boolean, persist = true) {
  enabled = v;
  listeners.forEach((l) => l(v));
  if (persist) void SecureStore.setItemAsync(KEY, v ? "on" : "off").catch(() => {});
}
export function hapticsEnabled() {
  return enabled;
}
export function useHapticsEnabled(): boolean {
  const [v, setV] = useState(enabled);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

function fire(kind: PulseKind) {
  if (!enabled) return;
  switch (kind) {
    case "soft": return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    case "light": return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case "medium": return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case "heavy": return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case "rigid": return void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    case "warning": return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case "error": return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    case "success": return void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

export function playBeat(beat: HapticBeat) {
  for (const p of beat.pulses) {
    if (p.at <= 0) fire(p.kind);
    else setTimeout(() => fire(p.kind), p.at);
  }
}

/** Short feedback moments used around the app. */
export const feel = {
  /** Finger lands on a button: instant, so the buzzer feels immediate. */
  press: () => fire("medium"),
  tap: () => fire("light"),
  select: () => void (enabled && Haptics.selectionAsync()),
  win: () => {
    fire("success");
    setTimeout(() => fire("heavy"), 140);
    setTimeout(() => fire("medium"), 260);
  },
  wrong: () => fire("error"),
  right: () => fire("success"),
  joined: () => {
    fire("light");
    setTimeout(() => fire("success"), 120);
  },
  go: () => {
    fire("rigid");
    setTimeout(() => fire("heavy"), 70);
    setTimeout(() => fire("success"), 160);
  },
};

/**
 * Drives the countdown buzz for a question. Call it every render with the time
 * left; it fires each beat of the plan once, and skips old beats if the phone
 * was locked or offline for a while.
 */
export function useQuestionHaptics(opts: { active: boolean; remainingMs: number | null; totalMs: number; roundKey: string | null }) {
  const plan = useMemo(() => countdownHapticPlan(Math.max(1000, opts.totalMs)), [opts.totalMs]);
  const prev = useRef<{ key: string | null; ms: number | null }>({ key: null, ms: null });
  useEffect(() => {
    if (!opts.active || opts.remainingMs === null) {
      prev.current = { key: opts.roundKey, ms: null };
      return;
    }
    const before = prev.current.key === opts.roundKey ? prev.current.ms : null;
    for (const b of dueHapticBeats(plan, before, opts.remainingMs)) playBeat(b);
    prev.current = { key: opts.roundKey, ms: opts.remainingMs };
  }, [opts.active, opts.remainingMs, opts.roundKey, plan]);
}

/** The 3-2-1 before a question, one tap per second. */
export function useReadyHaptics(opts: { active: boolean; remainingMs: number | null; roundKey: string | null }) {
  const plan = useMemo(() => getReadyHapticBeats(), []);
  const prev = useRef<{ key: string | null; ms: number | null }>({ key: null, ms: null });
  useEffect(() => {
    if (!opts.active || opts.remainingMs === null) {
      prev.current = { key: opts.roundKey, ms: null };
      return;
    }
    const before = prev.current.key === opts.roundKey ? prev.current.ms : null;
    for (const b of dueHapticBeats(plan, before, opts.remainingMs)) playBeat(b);
    prev.current = { key: opts.roundKey, ms: opts.remainingMs };
  }, [opts.active, opts.remainingMs, opts.roundKey, plan]);
}

export type { ServerClock };
