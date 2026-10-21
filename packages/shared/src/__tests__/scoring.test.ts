import { describe, expect, it } from "vitest";
import {
  normalizeSessionSettings,
  rankLeaderboard,
  resolveBuzzerRound,
  scoreMultipleChoiceAnswer,
  totalsFromLedger,
  winners,
} from "../index";

const mc = normalizeSessionSettings("multiple_choice", {});
const start = 1_000_000;
const deadline = start + 15_000;

describe("multiple choice scoring", () => {
  it("awards one point for a correct answer by default", () => {
    expect(scoreMultipleChoiceAnswer(mc, { isCorrect: true, startedAtMs: start, acceptedAtMs: start + 5000, deadlineMs: deadline }).total).toBe(1);
  });
  it("awards nothing for a wrong answer and no negative points", () => {
    const p = scoreMultipleChoiceAnswer(mc, { isCorrect: false, startedAtMs: start, acceptedAtMs: start + 1, deadlineMs: deadline });
    expect(p).toEqual({ base: 0, bonus: 0, total: 0 });
  });
  it("awards nothing when unanswered", () => {
    expect(scoreMultipleChoiceAnswer(mc, null).total).toBe(0);
  });
  it("awards nothing after the deadline", () => {
    expect(scoreMultipleChoiceAnswer(mc, { isCorrect: true, startedAtMs: start, acceptedAtMs: deadline + 1, deadlineMs: deadline }).total).toBe(0);
  });
  it("speed bonus is off by default and scales when enabled", () => {
    const s = { ...mc, speedBonus: true, speedBonusMaxPoints: 10 };
    expect(scoreMultipleChoiceAnswer(s, { isCorrect: true, startedAtMs: start, acceptedAtMs: start, deadlineMs: deadline })).toEqual({ base: 1, bonus: 10, total: 11 });
    expect(scoreMultipleChoiceAnswer(s, { isCorrect: true, startedAtMs: start, acceptedAtMs: start + 7500, deadlineMs: deadline }).bonus).toBe(5);
    expect(scoreMultipleChoiceAnswer(s, { isCorrect: true, startedAtMs: start, acceptedAtMs: deadline, deadlineMs: deadline }).bonus).toBe(0);
  });
});

describe("buzzer resolution", () => {
  it("first correct answer in server order wins, regardless of array order", () => {
    const r = resolveBuzzerRound(2, [
      { participantId: "b", choiceIndex: 2, serverOrder: 2 },
      { participantId: "a", choiceIndex: 2, serverOrder: 1 },
    ], { lockout: true, eligiblePlayers: 3 });
    expect(r.winnerId).toBe("a");
    expect(r.rejected).toEqual([{ participantId: "b", choiceIndex: 2, serverOrder: 2, reason: "question_closed" }]);
  });
  it("wrong answer locks the player out but does not end the question", () => {
    const r = resolveBuzzerRound(1, [
      { participantId: "a", choiceIndex: 0, serverOrder: 1 },
      { participantId: "a", choiceIndex: 1, serverOrder: 2 },
      { participantId: "b", choiceIndex: 1, serverOrder: 3 },
    ], { lockout: true, eligiblePlayers: 3 });
    expect(r.rejected[0]?.reason).toBe("locked_out");
    expect(r.winnerId).toBe("b");
  });
  it("closes with no winner when every eligible player is wrong", () => {
    const r = resolveBuzzerRound(3, [
      { participantId: "a", choiceIndex: 0, serverOrder: 1 },
      { participantId: "b", choiceIndex: 1, serverOrder: 2 },
    ], { lockout: true, eligiblePlayers: 2 });
    expect(r.winnerId).toBeNull();
    expect(r.closeReason).toBe("all_wrong");
  });
  it("simultaneous correct presses produce exactly one winner", () => {
    const attempts = Array.from({ length: 50 }, (_, i) => ({ participantId: `p${i}`, choiceIndex: 0, serverOrder: i }));
    const r = resolveBuzzerRound(0, attempts, { lockout: true, eligiblePlayers: 50 });
    expect(r.accepted.filter((a) => a.isCorrect)).toHaveLength(1);
    expect(r.winnerId).toBe("p0");
  });
  it("without lockout a player may try again", () => {
    const r = resolveBuzzerRound(1, [
      { participantId: "a", choiceIndex: 0, serverOrder: 1 },
      { participantId: "a", choiceIndex: 1, serverOrder: 2 },
    ], { lockout: false, eligiblePlayers: 2 });
    expect(r.winnerId).toBe("a");
  });
});

describe("leaderboard", () => {
  it("tied players share a rank (1, 1, 3)", () => {
    const rows = rankLeaderboard([
      { participantId: "a", displayName: "Ann", score: 3 },
      { participantId: "b", displayName: "Bob", score: 5 },
      { participantId: "c", displayName: "Cat", score: 5 },
      { participantId: "d", displayName: "Dan", score: 0 },
    ]);
    expect(rows.map((r) => [r.participantId, r.rank])).toEqual([["b", 1], ["c", 1], ["a", 3], ["d", 4]]);
    expect(winners(rows).map((r) => r.participantId)).toEqual(["b", "c"]);
  });
  it("no winner when nobody scored", () => {
    expect(winners(rankLeaderboard([{ participantId: "a", displayName: "A", score: 0 }]))).toEqual([]);
  });
  it("ledger totals ignore duplicates and voided rounds", () => {
    const t = totalsFromLedger([
      { participantId: "a", roundId: "r1", points: 1 },
      { participantId: "a", roundId: "r1", points: 1 },
      { participantId: "a", roundId: "r2", points: 1 },
      { participantId: "b", roundId: "r2", points: 1 },
    ], new Set(["r2"]));
    expect(t.get("a")).toBe(1);
    expect(t.get("b")).toBeUndefined();
  });
});
