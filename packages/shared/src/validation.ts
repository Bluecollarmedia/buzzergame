import { z } from "zod";
import { GAME_MODES } from "./settings";

export const LIMITS = {
  quizTitle: 120,
  quizDescription: 500,
  prompt: 300,
  choice: 120,
  displayName: 24,
  hostDisplayName: 60,
  maxQuestions: 200,
} as const;

export const questionSchema = z.object({
  prompt: z.string().max(LIMITS.prompt),
  choices: z.tuple([
    z.string().max(LIMITS.choice),
    z.string().max(LIMITS.choice),
    z.string().max(LIMITS.choice),
    z.string().max(LIMITS.choice),
  ]),
  correctIndex: z.number().int().min(0).max(3).nullable(),
  timeLimitSeconds: z.number().int().min(5).max(120).nullable().optional(),
});
export type QuestionDraft = z.infer<typeof questionSchema>;

export const quizMetaSchema = z.object({
  title: z.string().trim().min(1, "Give your quiz a title").max(LIMITS.quizTitle),
  description: z.string().max(LIMITS.quizDescription).optional().nullable(),
  mode: z.enum(GAME_MODES),
});

export interface QuestionIssue {
  index: number;
  field: "prompt" | "choices" | "correct";
  message: string;
}

/** Problems that would stop a question from being played. */
export function questionIssues(q: QuestionDraft, index: number): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const n = index + 1;
  if (!q.prompt.trim()) issues.push({ index, field: "prompt", message: `Question ${n} needs a prompt` });
  if (q.choices.some((c) => !c.trim()))
    issues.push({ index, field: "choices", message: `Question ${n} needs four answer choices` });
  if (q.correctIndex === null || q.correctIndex === undefined)
    issues.push({ index, field: "correct", message: `Question ${n} needs a correct answer` });
  return issues;
}

/** Mirrors private.quiz_problems() in the database. */
export function validateQuizForPlay(questions: QuestionDraft[]): string[] {
  if (questions.length === 0) return ["Add at least one question"];
  return questions.flatMap((q, i) => questionIssues(q, i).map((x) => x.message));
}

// ---------------------------------------------------------------------------
// Player names
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/;

export type NameResult = { ok: true; name: string } | { ok: false; error: string };

/** Mirrors private.normalize_name() in the database. */
export function normalizeDisplayName(raw: string): NameResult {
  if (CONTROL_CHARS.test(raw)) return { ok: false, error: "That name contains characters we can't show." };
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1) return { ok: false, error: "Enter a name." };
  if ([...name].length > LIMITS.displayName)
    return { ok: false, error: `Keep it to ${LIMITS.displayName} characters or fewer.` };
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// Auth forms
// ---------------------------------------------------------------------------
export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use 72 characters or fewer");

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(LIMITS.hostDisplayName),
  email: emailSchema,
  password: passwordSchema,
});
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

// ---------------------------------------------------------------------------
// Access codes and entitlements
// ---------------------------------------------------------------------------
export function normalizeAccessCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export interface AccessCodeState {
  revokedAt: string | null;
  expiresAt: string | null;
  redemptionCount: number;
  maxRedemptions: number;
  alreadyRedeemedByUser: boolean;
}

export type RedeemCheck =
  | { ok: true }
  | { ok: false; code: "code_revoked" | "code_expired" | "code_exhausted" | "code_already_redeemed" };

/** Mirrors the checks in public.redeem_access_code(). */
export function checkAccessCode(c: AccessCodeState, nowMs: number): RedeemCheck {
  if (c.revokedAt) return { ok: false, code: "code_revoked" };
  if (c.expiresAt && Date.parse(c.expiresAt) <= nowMs) return { ok: false, code: "code_expired" };
  if (c.redemptionCount >= c.maxRedemptions) return { ok: false, code: "code_exhausted" };
  if (c.alreadyRedeemedByUser) return { ok: false, code: "code_already_redeemed" };
  return { ok: true };
}

export interface EntitlementLike {
  status: "active" | "revoked";
  startsAt: string;
  expiresAt: string;
}

export function isEntitlementActive(e: EntitlementLike | null | undefined, nowMs: number): boolean {
  if (!e || e.status !== "active") return false;
  return Date.parse(e.startsAt) <= nowMs && Date.parse(e.expiresAt) > nowMs;
}

/** When a newly redeemed code's access starts (stacks after current access). */
export function stackedAccessWindow(
  existing: EntitlementLike[],
  durationMs: number,
  nowMs: number,
): { startsAt: number; expiresAt: number } {
  const latest = existing
    .filter((e) => e.status === "active" && Date.parse(e.expiresAt) > nowMs)
    .reduce((max, e) => Math.max(max, Date.parse(e.expiresAt)), nowMs);
  return { startsAt: latest, expiresAt: latest + durationMs };
}
