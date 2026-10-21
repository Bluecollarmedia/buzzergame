import type { SessionSettings } from "./settings";

/**
 * Scoring rules. Official scores are always computed by the database
 * (private.mc_points / submit_answer); these functions implement the same
 * rules for previews, tests and documentation.
 */

export interface McAnswerInput {
  isCorrect: boolean;
  acceptedAtMs: number;
  startedAtMs: number;
  deadlineMs: number;
}

export interface Points {
  base: number;
  bonus: number;
  total: number;
}

export function scoreMultipleChoiceAnswer(
  settings: Pick<SessionSettings, "pointsCorrect" | "speedBonus" | "speedBonusMaxPoints">,
  answer: McAnswerInput | null,
): Points {
  if (!answer || !answer.isCorrect) return { base: 0, bonus: 0, total: 0 };
  // Answers after the deadline are never accepted; treat defensively.
  if (answer.acceptedAtMs > answer.deadlineMs) return { base: 0, bonus: 0, total: 0 };
  let bonus = 0;
  if (settings.speedBonus) {
    const total = answer.deadlineMs - answer.startedAtMs;
    const left = Math.max(0, answer.deadlineMs - answer.acceptedAtMs);
    if (total > 0) bonus = Math.floor(settings.speedBonusMaxPoints * Math.min(1, left / total));
  }
  return { base: settings.pointsCorrect, bonus, total: settings.pointsCorrect + bonus };
}

export interface BuzzerAttempt {
  participantId: string;
  choiceIndex: number;
  /** Order in which the server accepted the attempt (lower = earlier). */
  serverOrder: number;
}

export interface BuzzerResolution {
  winnerId: string | null;
  /** Attempts the server accepted, in order. Later ones were rejected. */
  accepted: Array<BuzzerAttempt & { isCorrect: boolean }>;
  rejected: Array<BuzzerAttempt & { reason: "locked_out" | "question_closed" }>;
  closeReason: "winner" | "all_wrong" | null;
}

/**
 * Resolve a buzzer round given attempts in server acceptance order.
 * Client timestamps are deliberately not an input.
 */
export function resolveBuzzerRound(
  correctIndex: number,
  attempts: BuzzerAttempt[],
  opts: { lockout: boolean; eligiblePlayers: number },
): BuzzerResolution {
  const ordered = [...attempts].sort((a, b) => a.serverOrder - b.serverOrder);
  const out: BuzzerResolution = { winnerId: null, accepted: [], rejected: [], closeReason: null };
  const tried = new Set<string>();
  for (const a of ordered) {
    if (out.closeReason) {
      out.rejected.push({ ...a, reason: "question_closed" });
      continue;
    }
    if (opts.lockout && tried.has(a.participantId)) {
      out.rejected.push({ ...a, reason: "locked_out" });
      continue;
    }
    tried.add(a.participantId);
    const isCorrect = a.choiceIndex === correctIndex;
    out.accepted.push({ ...a, isCorrect });
    if (isCorrect) {
      out.winnerId = a.participantId;
      out.closeReason = "winner";
    } else if (opts.lockout && tried.size >= opts.eligiblePlayers) {
      out.closeReason = "all_wrong";
    }
  }
  return out;
}

export interface ScoreRow {
  participantId: string;
  displayName: string;
  score: number;
}

/**
 * Standard competition ranking: tied scores share a rank (1, 1, 3).
 * Ties are never broken arbitrarily.
 */
export function rankLeaderboard<T extends ScoreRow>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort(
    (a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName),
  );
  let lastScore: number | null = null;
  let lastRank = 0;
  return sorted.map((r, i) => {
    if (r.score !== lastScore) {
      lastRank = i + 1;
      lastScore = r.score;
    }
    return { ...r, rank: lastRank };
  });
}

/** Players sharing first place, or empty if nobody scored. */
export function winners<T extends { rank: number; score: number }>(rows: T[]): T[] {
  return rows.filter((r) => r.rank === 1 && r.score > 0);
}

/** Sum a ledger of score events, ignoring voided rounds. */
export function totalsFromLedger(
  events: Array<{ participantId: string; roundId: string; points: number }>,
  voidedRoundIds: Set<string> = new Set(),
): Map<string, number> {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const e of events) {
    if (voidedRoundIds.has(e.roundId)) continue;
    const key = `${e.roundId}:${e.participantId}`;
    if (seen.has(key)) continue; // one award per player per round
    seen.add(key);
    totals.set(e.participantId, (totals.get(e.participantId) ?? 0) + e.points);
  }
  return totals;
}
