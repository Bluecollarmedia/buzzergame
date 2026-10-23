import { File, Paths } from "expo-file-system";
import type { QuestionMedia, QuestionRow, QuizRow } from "./types";

/**
 * A copy of edits that haven't reached the server yet, kept on the phone.
 *
 * The server is the real draft store: every edit is saved to the quiz within
 * a second. This backup only covers the gap (no signal, app killed mid-save).
 * When the quiz is opened again, anything left here is put back and saved.
 */
export interface QuestionPatch {
  prompt: string;
  choices: [string, string, string, string];
  correct_index: number | null;
  time_limit_seconds: number | null;
  media: QuestionMedia | null;
}

export interface LocalBackup {
  savedAt: number;
  meta?: { title: string; description: string | null };
  settings?: Record<string, unknown>;
  questions: Record<string, QuestionPatch>;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const file = (quizId: string) => new File(Paths.document, `unsaved-${quizId.replace(/[^A-Za-z0-9-]/g, "")}.json`);

export async function readBackup(quizId: string): Promise<LocalBackup | null> {
  try {
    const f = file(quizId);
    if (!f.exists) return null;
    const b = JSON.parse(await f.text()) as LocalBackup;
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
    const f = file(quizId);
    if (!b.meta && !b.settings && Object.keys(b.questions).length === 0) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    f.write(JSON.stringify({ ...b, savedAt: Date.now() }));
  } catch {
    /* storage full: the server save still runs */
  }
}

export function clearBackup(quizId: string) {
  try {
    const f = file(quizId);
    if (f.exists) f.delete();
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
      JSON.stringify(p.media ?? null) === JSON.stringify(r.media ?? null) &&
      JSON.stringify(p.choices) === JSON.stringify(r.choices);
    if (same) return r;
    keys.add(r.id);
    return { ...r, ...p };
  });
  return keys;
}
