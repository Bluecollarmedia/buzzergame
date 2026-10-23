"use client";

import type { QuestionRow, QuizRow } from "@/lib/types";

/**
 * A copy of edits that haven't reached the server yet, kept in this browser.
 *
 * The server is the real draft store: every edit is saved to the quiz within
 * a second. This backup only covers the gap: a phone that loses signal, a tab
 * that's swiped away mid-save, or a browser that's killed before the save
 * finishes. When the quiz is opened again, anything left here is put back and
 * saved.
 */

export interface QuestionPatch {
  prompt: string;
  choices: [string, string, string, string];
  correct_index: number | null;
  time_limit_seconds: number | null;
}

export interface LocalBackup {
  savedAt: number;
  meta?: { title: string; description: string | null };
  settings?: Record<string, unknown>;
  questions: Record<string, QuestionPatch>;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const key = (quizId: string) => `crowdquiz:unsaved:${quizId}`;

export function readBackup(quizId: string): LocalBackup | null {
  try {
    const raw = window.localStorage.getItem(key(quizId));
    if (!raw) return null;
    const b = JSON.parse(raw) as LocalBackup;
    if (!b || typeof b.savedAt !== "number" || Date.now() - b.savedAt > MAX_AGE_MS) {
      clearBackup(quizId);
      return null;
    }
    return { ...b, questions: b.questions ?? {} };
  } catch {
    return null;
  }
}

export function writeBackup(quizId: string, b: Omit<LocalBackup, "savedAt">) {
  try {
    if (!b.meta && !b.settings && Object.keys(b.questions).length === 0) {
      window.localStorage.removeItem(key(quizId));
      return;
    }
    window.localStorage.setItem(key(quizId), JSON.stringify({ ...b, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked: the server save still runs */
  }
}

export function clearBackup(quizId: string) {
  try {
    window.localStorage.removeItem(key(quizId));
  } catch {
    /* ignore */
  }
}

/** Applies a local backup onto freshly loaded data; returns the keys that changed. */
export function applyBackup(b: LocalBackup | null, d: { quiz: QuizRow; rows: QuestionRow[] }): Set<string> {
  const keys = new Set<string>();
  if (!b) return keys;
  if (b.meta && (b.meta.title !== d.quiz.title || (b.meta.description ?? null) !== (d.quiz.description ?? null))) {
    d.quiz = { ...d.quiz, title: b.meta.title, description: b.meta.description };
    keys.add("meta");
  }
  if (b.settings && JSON.stringify(b.settings) !== JSON.stringify(d.quiz.settings)) {
    d.quiz = { ...d.quiz, settings: b.settings };
    keys.add("settings");
  }
  d.rows = d.rows.map((r) => {
    const p = b.questions[r.id];
    if (!p) return r;
    const same =
      p.prompt === r.prompt &&
      p.correct_index === r.correct_index &&
      p.time_limit_seconds === r.time_limit_seconds &&
      JSON.stringify(p.choices) === JSON.stringify(r.choices);
    if (same) return r;
    keys.add(r.id);
    return { ...r, ...p };
  });
  return keys;
}
