import { describe, expect, it } from "vitest";
import { countdownHapticPlan, dueHapticBeats, getReadyHapticBeats } from "../haptics";

const secs = (plan: ReturnType<typeof countdownHapticPlan>) => plan.map((b) => b.remainingMs / 1000);

describe("countdown haptic plan", () => {
  it("is calm for the first part of a long question and builds toward the end", () => {
    const plan = countdownHapticPlan(30_000);
    expect(secs(plan)).toEqual([10, 8, 6, 5, 4, 3, 2, 1, 0]);
    const strength = (b: (typeof plan)[number]) => b.pulses.length;
    expect(strength(plan.find((b) => b.remainingMs === 1000)!)).toBeGreaterThan(strength(plan.find((b) => b.remainingMs === 5000)!));
    expect(plan.find((b) => b.remainingMs === 10_000)!.pulses.map((p) => p.kind)).toEqual(["soft"]);
    expect(plan.at(-1)!.pulses.some((p) => p.kind === "error")).toBe(true);
  });

  it("skips the early beats on short questions and never fires at the very start", () => {
    expect(secs(countdownHapticPlan(5_000))).toEqual([4, 3, 2, 1, 0]);
    expect(secs(countdownHapticPlan(15_000))).toEqual([10, 8, 6, 5, 4, 3, 2, 1, 0]);
    expect(secs(countdownHapticPlan(8_000))).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  it("keeps every pulse inside its own second so beats never overlap", () => {
    for (const b of countdownHapticPlan(30_000)) {
      if (b.remainingMs === 0) continue;
      expect(Math.max(...b.pulses.map((p) => p.at))).toBeLessThan(1000);
    }
  });

  it("rising buzz gets stronger", () => {
    const order = ["light", "medium", "heavy", "rigid"];
    const buzz = countdownHapticPlan(30_000).find((b) => b.remainingMs === 1000)!.pulses.map((p) => order.indexOf(p.kind));
    expect(buzz).toEqual([...buzz].sort((a, b) => a - b));
    expect(buzz.length).toBeGreaterThanOrEqual(15);
  });
});

describe("due beats", () => {
  const plan = countdownHapticPlan(30_000);
  it("fires each beat once as time passes", () => {
    const fired: number[] = [];
    let prev: number | null = null;
    for (let r = 30_000; r >= -100; r -= 100) {
      for (const b of dueHapticBeats(plan, prev, r)) fired.push(b.remainingMs);
      prev = r;
    }
    expect(fired).toEqual([10000, 8000, 6000, 5000, 4000, 3000, 2000, 1000, 0]);
  });
  it("does not replay missed beats after the phone was away", () => {
    expect(dueHapticBeats(plan, 20_000, 3_050)).toEqual([]);
    expect(dueHapticBeats(plan, null, 4_900).map((b) => b.remainingMs)).toEqual([5000]);
  });
  it("has a 3-2-1 ready plan", () => {
    expect(getReadyHapticBeats().map((b) => b.pulses[0]!.kind)).toEqual(["light", "medium", "heavy"]);
  });
});
