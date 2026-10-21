import { describe, expect, it } from "vitest";
import {
  ANSWER_COLORS,
  allowedHostCommands,
  canTransition,
  checkAccessCode,
  isEntitlementActive,
  normalizeAccessCode,
  normalizeDisplayName,
  normalizeSessionSettings,
  stackedAccessWindow,
  validateQuizForPlay,
  toAppError,
  errorMessage,
} from "../index";

describe("settings", () => {
  it("defaults match the spec", () => {
    const mc = normalizeSessionSettings("multiple_choice", undefined);
    expect(mc.timeLimitSeconds).toBe(15);
    expect(mc.autoAdvance).toBe(true);
    expect(mc.pointsCorrect).toBe(1);
    expect(mc.speedBonus).toBe(false);
    const bz = normalizeSessionSettings("color_buzzer", {});
    expect(bz.buzzerTimeLimitSeconds).toBeNull();
    expect(bz.buzzerLockout).toBe(true);
    expect(bz.autoAdvance).toBe(false);
  });
  it("clamps out-of-range values", () => {
    const s = normalizeSessionSettings("multiple_choice", { timeLimitSeconds: 9999, maxPlayers: -5, pointsCorrect: "x" });
    expect(s.timeLimitSeconds).toBe(120);
    expect(s.maxPlayers).toBe(2);
    expect(s.pointsCorrect).toBe(1);
  });
});

describe("colour mapping", () => {
  it("is Red A, Blue B, Green C, Purple D", () => {
    expect(ANSWER_COLORS.map((c) => `${c.name}:${c.label}`)).toEqual(["Red:A", "Blue:B", "Green:C", "Purple:D"]);
  });
});

describe("state machine", () => {
  it("rejects invalid transitions", () => {
    expect(canTransition("lobby", "reveal")).toBe(false);
    expect(canTransition("finished", "lobby")).toBe(false);
    expect(canTransition("question_open", "reveal")).toBe(true);
    expect(canTransition("paused", "question_open")).toBe(true);
  });
  it("only offers sensible host commands", () => {
    expect(allowedHostCommands("lobby")).toContain("start");
    expect(allowedHostCommands("paused")).toEqual(["resume", "end", "remove_player"]);
    expect(allowedHostCommands("question_open", { allowReplay: false })).not.toContain("replay");
    expect(allowedHostCommands("finished")).toEqual([]);
  });
});

describe("quiz validation", () => {
  const good = { prompt: "Capital of France?", choices: ["Paris", "Rome", "Oslo", "Bern"] as [string, string, string, string], correctIndex: 0 };
  it("accepts a complete quiz", () => {
    expect(validateQuizForPlay([good])).toEqual([]);
  });
  it("requires at least one question", () => {
    expect(validateQuizForPlay([])).toEqual(["Add at least one question"]);
  });
  it("reports missing prompt, choices and correct answer", () => {
    expect(validateQuizForPlay([{ prompt: " ", choices: ["a", "", "c", "d"], correctIndex: null }])).toEqual([
      "Question 1 needs a prompt",
      "Question 1 needs four answer choices",
      "Question 1 needs a correct answer",
    ]);
  });
});

describe("display names", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDisplayName("  Ada   Lovelace ")).toEqual({ ok: true, name: "Ada Lovelace" });
  });
  it("rejects control characters, empty and long names", () => {
    expect(normalizeDisplayName("bad\u0007name").ok).toBe(false);
    expect(normalizeDisplayName("zero​width").ok).toBe(false);
    expect(normalizeDisplayName("   ").ok).toBe(false);
    expect(normalizeDisplayName("x".repeat(25)).ok).toBe(false);
    expect(normalizeDisplayName("x".repeat(24)).ok).toBe(true);
  });
});

describe("access codes and entitlements", () => {
  const now = Date.parse("2026-01-10T00:00:00Z");
  const base = { revokedAt: null, expiresAt: null, redemptionCount: 0, maxRedemptions: 1, alreadyRedeemedByUser: false };
  it("normalizes codes", () => {
    expect(normalizeAccessCode(" abcd-efgh-2345 ")).toBe("ABCDEFGH2345");
  });
  it("rejects expired, revoked, exhausted and repeated codes", () => {
    expect(checkAccessCode(base, now)).toEqual({ ok: true });
    expect(checkAccessCode({ ...base, expiresAt: "2026-01-09T00:00:00Z" }, now)).toEqual({ ok: false, code: "code_expired" });
    expect(checkAccessCode({ ...base, revokedAt: "2026-01-01T00:00:00Z" }, now)).toEqual({ ok: false, code: "code_revoked" });
    expect(checkAccessCode({ ...base, redemptionCount: 1 }, now)).toEqual({ ok: false, code: "code_exhausted" });
    expect(checkAccessCode({ ...base, maxRedemptions: 5, alreadyRedeemedByUser: true }, now)).toEqual({ ok: false, code: "code_already_redeemed" });
  });
  it("entitlement is active only inside its window", () => {
    const e = { status: "active" as const, startsAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-11T00:00:00Z" };
    expect(isEntitlementActive(e, now)).toBe(true);
    expect(isEntitlementActive({ ...e, expiresAt: "2026-01-09T00:00:00Z" }, now)).toBe(false);
    expect(isEntitlementActive({ ...e, status: "revoked" }, now)).toBe(false);
    expect(isEntitlementActive(null, now)).toBe(false);
  });
  it("new access stacks after existing access", () => {
    const w = stackedAccessWindow([{ status: "active", startsAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-11T00:00:00Z" }], 86400000, now);
    expect(new Date(w.startsAt).toISOString()).toBe("2026-01-11T00:00:00.000Z");
    expect(new Date(w.expiresAt).toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });
});

describe("errors", () => {
  it("maps database error codes to friendly messages", () => {
    const e = toAppError({ message: "CQ:too_late" });
    expect(e.code).toBe("too_late");
    expect(e.message).toMatch(/Time's up/);
    expect(errorMessage({ message: "CQ:quiz_invalid", details: "Question 1 needs a prompt" })).toMatch(/Question 1/);
    expect(toAppError(new TypeError("Failed to fetch")).code).toBe("network");
  });
});
