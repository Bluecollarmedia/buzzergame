import type { GameMode, SessionSettings } from "./settings";
import type { SessionStatus } from "./stateMachine";

/** Shapes returned by the database RPCs (see supabase/migrations). */

export interface SessionCore {
  id: string;
  title: string;
  mode: GameMode;
  status: SessionStatus;
  pausedFrom: SessionStatus | null;
  pausedRemainingMs: number | null;
  questionCount: number;
  /** 0-based index of the current question, null before the game starts. */
  currentPosition: number | null;
  phaseEndsAt: string | null;
  stateVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  playerCount: number;
  settings: Partial<SessionSettings>;
}

export interface QuestionView {
  position: number;
  roundId?: string | null;
  attempt?: number | null;
  /** Never sent to players. */
  prompt?: string | null;
  choices?: [string, string, string, string] | null;
  /** Photo for this question (path in the question-images bucket). Projector and host only. */
  imagePath?: string | null;
  startedAt?: string | null;
  deadline?: string | null;
  roundStatus?: "open" | "closed" | "voided" | null;
  closeReason?: string | null;
  /** Only present after the question closes (or for the host). */
  correctIndex?: number | null;
  distribution?: [number, number, number, number] | null;
  winner?: { participantId: string; displayName: string; choiceIndex: number } | null;
  answerCount?: number;
}

export interface LeaderboardRow {
  participantId: string;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  rank: number;
}

export interface PlayerAnswer {
  choiceIndex: number;
  attemptNo: number;
  acceptedAt: string;
  isCorrect: boolean | null;
}

export interface PlayerState {
  serverNow: string;
  session: SessionCore;
  me: {
    participantId: string;
    displayName: string;
    score: number;
    rank: number | null;
    correctCount: number;
  };
  question: QuestionView | null;
  myAnswers: PlayerAnswer[];
  myRoundPoints: number | null;
  leaderboard: LeaderboardRow[] | null;
  results: { questionsPlayed: number } | null;
}

export interface ProjectorState {
  serverNow: string;
  session: SessionCore;
  join: { joinToken: string; roomCode: string; open: boolean } | null;
  players: Array<{ participantId: string; displayName: string }> | null;
  question: QuestionView | null;
  leaderboard: LeaderboardRow[] | null;
  results: { questionsPlayed: number; standings: LeaderboardRow[] } | null;
}

export interface HostState {
  serverNow: string;
  session: SessionCore & { settings: SessionSettings };
  join: { joinToken: string; roomCode: string; projectorToken: string; open: boolean };
  question: QuestionView | null;
  nextQuestion: { position: number; prompt: string } | null;
  players: Array<{ participantId: string; displayName: string; joinedAt: string; lastSeenAt: string }>;
  attempts: Array<{
    participantId: string;
    displayName: string;
    choiceIndex: number;
    isCorrect: boolean;
    acceptedAt: string;
    attemptNo: number;
  }>;
  leaderboard: LeaderboardRow[];
  results: { questionsPlayed: number; standings: LeaderboardRow[] } | null;
}

export interface JoinInfo {
  sessionId: string;
  title: string;
  mode: GameMode;
  status: SessionStatus;
  joinable: boolean;
  reason: string | null;
}

export interface JoinResult {
  participantId: string;
  sessionId: string;
  displayName: string;
  rejoined: boolean;
}

export type SubmitResultKind = "accepted" | "changed" | "duplicate" | "won" | "wrong";
export interface SubmitResult {
  result: SubmitResultKind;
  choiceIndex: number;
  answerId: string;
  points?: number;
  lockedOut?: boolean;
}

export interface SessionResults {
  session: SessionCore & { createdAt: string; quizId: string | null };
  standings: LeaderboardRow[];
  questionsPlayed: number;
  questions: Array<{
    position: number;
    prompt: string;
    choices: [string, string, string, string];
    correctIndex: number;
    played: boolean;
    answerCount: number;
    correctCount: number;
    winner: string | null;
    closeReason: string | null;
  }>;
}

export interface EntitlementStatus {
  active: boolean;
  isAdmin: boolean;
  plan: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  currentExpiresAt: string | null;
  source: string | null;
  maxSessions: number | null;
  sessionsUsed: number;
  serverNow: string;
}
