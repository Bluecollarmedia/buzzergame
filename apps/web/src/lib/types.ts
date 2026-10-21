import type { GameMode, SessionStatus } from "@crowdquiz/shared";

export interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  mode: GameMode;
  status: "draft" | "ready";
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  questions?: Array<{ count: number }>;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  position: number;
  prompt: string;
  choices: [string, string, string, string];
  correct_index: number | null;
  time_limit_seconds: number | null;
}

export interface SessionRow {
  id: string;
  quiz_id: string | null;
  quiz_title: string;
  mode: GameMode;
  status: SessionStatus;
  room_code: string;
  question_count: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  // Only ids: a count embed reads every column, and hosts may not read the secret hash column.
  participants?: Array<{ id: string }>;
}

export const LIVE_STATUSES: SessionStatus[] = ["lobby", "countdown", "question_open", "reveal", "leaderboard", "paused"];
