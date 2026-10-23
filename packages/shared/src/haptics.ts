/**
 * Haptic design for the phone app.
 *
 * The app turns the server countdown into a plan of "beats". Nothing here
 * touches the phone: it only says what to feel and when, so the plan is the
 * same on every device and can be tested.
 *
 * What the player feels during a question (any timer length):
 *   - more than 10s left: nothing, so the start of a question stays calm
 *   - 10s, 8s, 6s left: one soft tap (a slow heartbeat starting up)
 *   - 5s and 4s left:   a double tap, "zzt-zzt", once a second
 *   - 3s and 2s left:   a heavy triple tap, once a second
 *   - 1s left:          a fast rising buzz that fills the whole last second
 *   - time's up:        one hard buzz and an error thump
 *
 * Short questions simply skip the early beats, because beats are placed by
 * the time remaining, not by the share of the timer used.
 */
export type PulseKind = "soft" | "light" | "medium" | "heavy" | "rigid" | "warning" | "error" | "success";

export interface Pulse {
  /** Milliseconds after the beat starts. */
  at: number;
  kind: PulseKind;
}

export interface HapticBeat {
  /** Fires when this many milliseconds (or fewer) are left. */
  remainingMs: number;
  pulses: Pulse[];
}

const SECOND = 1000;

function tap(kinds: PulseKind[], gap: number): Pulse[] {
  return kinds.map((kind, i) => ({ at: i * gap, kind }));
}

/** A fast buzz: many quick taps that get stronger toward the end. */
function risingBuzz(durationMs: number, stepMs: number): Pulse[] {
  const pulses: Pulse[] = [];
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps; i++) {
    const p = i / Math.max(1, steps - 1);
    pulses.push({ at: i * stepMs, kind: p < 0.34 ? "light" : p < 0.67 ? "medium" : p < 0.9 ? "heavy" : "rigid" });
  }
  return pulses;
}

/** All beats for a question that lasts `totalMs`, from first to last. */
export function countdownHapticPlan(totalMs: number): HapticBeat[] {
  const beats: HapticBeat[] = [];
  // Never fire right at the start of the question.
  const add = (seconds: number, pulses: Pulse[]) => {
    const remainingMs = seconds * SECOND;
    if (remainingMs < totalMs - 600) beats.push({ remainingMs, pulses });
  };

  for (const s of [10, 8, 6]) if (s <= totalMs / SECOND) add(s, [{ at: 0, kind: "soft" }]);
  for (const s of [5, 4]) add(s, tap(["medium", "medium"], 120));
  for (const s of [3, 2]) add(s, tap(["heavy", "heavy", "rigid"], 100));
  add(1, risingBuzz(900, 45));

  beats.push({ remainingMs: 0, pulses: [...tap(["rigid", "rigid", "heavy"], 70), { at: 260, kind: "error" }] });
  return beats.sort((a, b) => b.remainingMs - a.remainingMs);
}

/**
 * The beats to fire now, given the previous and current time left.
 *
 * `previousMs` is null the first time. If the phone was away (locked, or the
 * app was in the background) for longer than `maxGapMs`, old beats are
 * skipped rather than replayed all at once.
 */
export function dueHapticBeats(
  plan: HapticBeat[],
  previousMs: number | null,
  currentMs: number,
  maxGapMs = 1500,
): HapticBeat[] {
  if (previousMs === null) return plan.filter((b) => b.remainingMs >= currentMs && b.remainingMs <= currentMs + 250);
  if (previousMs - currentMs > maxGapMs) return plan.filter((b) => b.remainingMs >= currentMs && b.remainingMs <= currentMs + 250);
  return plan.filter((b) => b.remainingMs < previousMs && b.remainingMs >= currentMs);
}

/** The "3, 2, 1" before a question: one rising tap per second, then GO. */
export function getReadyHapticBeats(): HapticBeat[] {
  return [
    { remainingMs: 3000, pulses: [{ at: 0, kind: "light" }] },
    { remainingMs: 2000, pulses: [{ at: 0, kind: "medium" }] },
    { remainingMs: 1000, pulses: [{ at: 0, kind: "heavy" }] },
  ];
}
