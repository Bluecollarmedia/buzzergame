import { z } from "zod";

export const GAME_MODES = ["multiple_choice", "color_buzzer"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const GAME_MODE_INFO: Record<GameMode, { name: string; summary: string }> = {
  multiple_choice: {
    name: "Multiple Choice",
    summary: "Timed questions. Everyone answers A, B, C or D before the clock runs out.",
  },
  color_buzzer: {
    name: "Color Buzzer",
    summary: "Race to press the right colour. The first correct answer wins the point.",
  },
};

/** Limits mirrored from private.normalize_settings() in the database. */
export const SETTING_LIMITS = {
  timeLimitSeconds: { min: 5, max: 120, default: 15 },
  countdownSeconds: { min: 0, max: 10, default: 3 },
  revealSeconds: { min: 2, max: 30, default: 5 },
  leaderboardSeconds: { min: 2, max: 30, default: 5 },
  pointsCorrect: { min: 0, max: 1000, default: 1 },
  speedBonusMaxPoints: { min: 0, max: 1000, default: 1 },
  buzzerTimeLimitSeconds: { min: 5, max: 300, default: 30 },
  maxPlayers: { min: 2, max: 500, default: 100 },
} as const;

export interface SessionSettings {
  timeLimitSeconds: number;
  countdownSeconds: number;
  revealSeconds: number;
  leaderboardSeconds: number;
  showLeaderboard: boolean;
  autoAdvance: boolean;
  allowAnswerChange: boolean;
  allowLateJoin: boolean;
  pointsCorrect: number;
  speedBonus: boolean;
  speedBonusMaxPoints: number;
  buzzerLockout: boolean;
  /** null = no countdown in Color Buzzer (default). */
  buzzerTimeLimitSeconds: number | null;
  allowReplay: boolean;
  showChoicesOnPhone: boolean;
  maxPlayers: number;
  /** Music and sound effects on the projector. */
  soundOn: boolean;
}

function clampInt(v: unknown, key: keyof typeof SETTING_LIMITS): number {
  const lim = SETTING_LIMITS[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return lim.default;
  return Math.max(lim.min, Math.min(lim.max, Math.round(v)));
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

/** Fill defaults and clamp values. Must match private.normalize_settings(). */
export function normalizeSessionSettings(
  mode: GameMode,
  input: Partial<Record<keyof SessionSettings, unknown>> | null | undefined,
): SessionSettings {
  const p = input ?? {};
  const isMc = mode === "multiple_choice";
  return {
    timeLimitSeconds: clampInt(p.timeLimitSeconds, "timeLimitSeconds"),
    countdownSeconds: clampInt(p.countdownSeconds, "countdownSeconds"),
    revealSeconds: clampInt(p.revealSeconds, "revealSeconds"),
    leaderboardSeconds: clampInt(p.leaderboardSeconds, "leaderboardSeconds"),
    showLeaderboard: bool(p.showLeaderboard, true),
    autoAdvance: bool(p.autoAdvance, isMc),
    allowAnswerChange: bool(p.allowAnswerChange, false),
    allowLateJoin: bool(p.allowLateJoin, true),
    pointsCorrect: clampInt(p.pointsCorrect, "pointsCorrect"),
    speedBonus: bool(p.speedBonus, false),
    speedBonusMaxPoints: clampInt(p.speedBonusMaxPoints, "speedBonusMaxPoints"),
    buzzerLockout: bool(p.buzzerLockout, true),
    buzzerTimeLimitSeconds:
      typeof p.buzzerTimeLimitSeconds === "number" && Number.isFinite(p.buzzerTimeLimitSeconds)
        ? clampInt(p.buzzerTimeLimitSeconds, "buzzerTimeLimitSeconds")
        : null,
    allowReplay: bool(p.allowReplay, true),
    showChoicesOnPhone: bool(p.showChoicesOnPhone, isMc),
    maxPlayers: clampInt(p.maxPlayers, "maxPlayers"),
    soundOn: bool(p.soundOn, true),
  };
}

/** Form schema for the launch / quiz settings editor. */
export const sessionSettingsFormSchema = z.object({
  timeLimitSeconds: z.number().int().min(5).max(120),
  countdownSeconds: z.number().int().min(0).max(10),
  revealSeconds: z.number().int().min(2).max(30),
  leaderboardSeconds: z.number().int().min(2).max(30),
  showLeaderboard: z.boolean(),
  autoAdvance: z.boolean(),
  allowAnswerChange: z.boolean(),
  allowLateJoin: z.boolean(),
  pointsCorrect: z.number().int().min(0).max(1000),
  speedBonus: z.boolean(),
  speedBonusMaxPoints: z.number().int().min(0).max(1000),
  buzzerLockout: z.boolean(),
  buzzerTimeLimitSeconds: z.number().int().min(5).max(300).nullable(),
  allowReplay: z.boolean(),
  showChoicesOnPhone: z.boolean(),
  maxPlayers: z.number().int().min(2).max(500),
  soundOn: z.boolean(),
});
