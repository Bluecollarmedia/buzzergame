/**
 * Session state machine. The database (private.step / public.host_command)
 * is the authority; this module documents the same rules for the UI and tests.
 */
export const SESSION_STATUSES = [
  "lobby",
  "countdown",
  "question_open",
  "reveal",
  "leaderboard",
  "paused",
  "finished",
  "aborted",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type HostCommand =
  | "start"
  | "pause"
  | "resume"
  | "next"
  | "close_question"
  | "skip"
  | "replay"
  | "end"
  | "remove_player";

/** Statuses that progress on a timer and can be paused. */
export const ACTIVE_STATUSES: readonly SessionStatus[] = [
  "countdown",
  "question_open",
  "reveal",
  "leaderboard",
];

export const TERMINAL_STATUSES: readonly SessionStatus[] = ["finished", "aborted"];

/** Every transition the server may perform. */
export const TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  lobby: ["countdown", "question_open", "aborted"],
  countdown: ["question_open", "countdown", "paused", "finished"],
  question_open: ["reveal", "countdown", "paused", "finished"],
  reveal: ["leaderboard", "countdown", "paused", "finished"],
  leaderboard: ["countdown", "paused", "finished"],
  paused: ["countdown", "question_open", "reveal", "leaderboard", "finished"],
  finished: [],
  aborted: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Commands a host may issue in a given status (server checks again). */
export function allowedHostCommands(
  status: SessionStatus,
  opts: { allowReplay?: boolean } = {},
): HostCommand[] {
  const replay = opts.allowReplay !== false;
  switch (status) {
    case "lobby":
      return ["start", "end", "remove_player"];
    case "countdown":
      return ["pause", "next", "skip", "end", "remove_player"];
    case "question_open":
      return [
        "pause",
        "close_question",
        "skip",
        ...(replay ? (["replay"] as const) : []),
        "end",
        "remove_player",
      ];
    case "reveal":
    case "leaderboard":
      return ["pause", "next", "skip", ...(replay ? (["replay"] as const) : []), "end", "remove_player"];
    case "paused":
      return ["resume", "end", "remove_player"];
    default:
      return [];
  }
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  lobby: "Lobby",
  countdown: "Get ready",
  question_open: "Question open",
  reveal: "Answer reveal",
  leaderboard: "Leaderboard",
  paused: "Paused",
  finished: "Finished",
  aborted: "Cancelled",
};
