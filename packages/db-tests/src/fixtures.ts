import type { QuizSpec } from "./db";

export const mcQuiz = (n = 3, settings: Record<string, unknown> = {}): QuizSpec => ({
  mode: "multiple_choice",
  settings,
  questions: Array.from({ length: n }, (_, i) => ({
    prompt: `Question ${i + 1}?`,
    choices: ["Alpha", "Bravo", "Charlie", "Delta"] as [string, string, string, string],
    correct: i % 4,
  })),
});

export const buzzerQuiz = (n = 2, settings: Record<string, unknown> = {}): QuizSpec => ({
  mode: "color_buzzer",
  settings,
  questions: Array.from({ length: n }, (_, i) => ({
    prompt: `Buzzer ${i + 1}?`,
    choices: ["Red one", "Blue one", "Green one", "Purple one"] as [string, string, string, string],
    correct: (i + 2) % 4,
  })),
});
