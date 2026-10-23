import { beforeEach, describe, expect, it } from "vitest";
import type { QuestionRow, QuizRow } from "@/lib/types";
import { applyBackup, clearBackup, readBackup, writeBackup } from "../localBackup";

const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const quiz: QuizRow = {
  id: "qz", title: "Trivia", description: null, mode: "multiple_choice", status: "draft",
  settings: {}, created_at: "", updated_at: "",
};
const row = (id: string, prompt: string): QuestionRow => ({
  id, quiz_id: "qz", position: 0, prompt, choices: ["a", "b", "c", "d"], correct_index: 0, time_limit_seconds: null,
});

describe("local backup of unsaved edits", () => {
  beforeEach(() => store.clear());

  it("round-trips and clears when nothing is pending", () => {
    writeBackup("qz", { questions: { q1: { prompt: "Hi", choices: ["a", "b", "c", "d"], correct_index: 1, time_limit_seconds: null } } });
    expect(readBackup("qz")?.questions.q1?.prompt).toBe("Hi");
    writeBackup("qz", { questions: {} });
    expect(readBackup("qz")).toBeNull();
    writeBackup("qz", { meta: { title: "x", description: null }, questions: {} });
    clearBackup("qz");
    expect(readBackup("qz")).toBeNull();
  });

  it("puts back only edits the server doesn't have", () => {
    const d = { quiz, rows: [row("q1", "Old"), row("q2", "Same")] };
    const keys = applyBackup(
      {
        savedAt: Date.now(),
        meta: { title: "New title", description: null },
        questions: {
          q1: { prompt: "Typed offline", choices: ["a", "b", "c", "d"], correct_index: 0, time_limit_seconds: null },
          q2: { prompt: "Same", choices: ["a", "b", "c", "d"], correct_index: 0, time_limit_seconds: null },
          gone: { prompt: "Deleted elsewhere", choices: ["a", "b", "c", "d"], correct_index: 0, time_limit_seconds: null },
        },
      },
      d,
    );
    expect([...keys].sort()).toEqual(["meta", "q1"]);
    expect(d.quiz.title).toBe("New title");
    expect(d.rows[0]!.prompt).toBe("Typed offline");
    expect(d.rows).toHaveLength(2);
  });

  it("drops very old backups", () => {
    store.set("crowdquiz:unsaved:qz", JSON.stringify({ savedAt: Date.now() - 40 * 864e5, questions: {} }));
    expect(readBackup("qz")).toBeNull();
    expect(store.size).toBe(0);
  });
});
