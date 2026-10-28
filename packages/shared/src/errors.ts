/**
 * Application error codes raised by the database as 'CQ:<code>' and the
 * message each one shows to people. Messages explain what happened and what
 * to do next, without internal details.
 */
export const ERROR_MESSAGES = {
  not_authenticated: "Please sign in again.",
  account_disabled: "This account has been disabled. Contact support if you think this is a mistake.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find that. It may have been deleted.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  invalid_request: "Something about that request wasn't right. Refresh and try again.",
  internal: "Something went wrong on our side. Try again in a moment.",
  // Hosting
  no_entitlement: "Your hosting access isn't active. Redeem an access code to launch games.",
  session_limit_reached: "You've used all the games included in your current access.",
  quiz_invalid: "This quiz isn't ready to play yet.",
  too_many_live_sessions: "You have too many games running. End one before starting another.",
  too_many_questions: "A quiz can have up to 200 questions.",
  too_many_quizzes: "You've reached the maximum number of quizzes.",
  // Photos
  photo_limit: "You've reached your photo limit. Remove a photo you don't need, then try again.",
  photo_uploads_off: "Photo uploads are turned off right now.",
  photo_upload_failed: "Couldn't upload the photo. Check your connection and try again.",
  // Joining
  session_not_found: "We couldn't find that game. Check the code or scan the QR code again.",
  session_ended: "This game has ended.",
  late_join_disabled: "This game has already started and isn't accepting new players.",
  session_full: "This game is full.",
  name_taken: "Someone already has that name in this game. Try adding an initial.",
  invalid_name: "Choose a different name (1 to 24 characters).",
  invalid_player: "We couldn't confirm your player. Join the game again.",
  player_removed: "The host removed you from this game.",
  // Playing
  invalid_choice: "Choose A, B, C or D.",
  game_paused: "The game is paused.",
  question_closed: "This question is closed.",
  too_late: "Time's up. Your answer arrived after the deadline.",
  already_answered: "You've already answered this question.",
  locked_out: "You've already used your attempt on this question.",
  // Host controls
  invalid_transition: "That action isn't available right now.",
  invalid_command: "Unknown action.",
  no_players: "Wait for at least one player to join before starting.",
  replay_disabled: "Replaying questions is turned off for this game.",
  // Access codes
  code_invalid: "That code isn't valid. Check it and try again.",
  code_revoked: "That code has been cancelled.",
  code_expired: "That code has expired.",
  code_exhausted: "That code has already been used the maximum number of times.",
  code_already_redeemed: "You've already redeemed that code.",
  code_exists: "A code with that text already exists.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(
    public code: ErrorCode | "network" | "unknown",
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Convert a Supabase/PostgREST error (or anything thrown) into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { message?: string; details?: string; code?: string; name?: string } | null;
  const msg = e?.message ?? "";
  const m = /CQ:([a-z_]+)/.exec(msg);
  if (m) {
    const code = m[1] as ErrorCode;
    const text = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal;
    return new AppError(code in ERROR_MESSAGES ? code : "unknown", text, e?.details || undefined);
  }
  if (
    /Failed to fetch|NetworkError|Network request failed|fetch failed|ECONNREFUSED|timeout/i.test(msg) ||
    e?.name === "TypeError"
  ) {
    return new AppError("network", "Connection problem. Check your internet and try again.");
  }
  return new AppError("unknown", "Something went wrong. Try again.");
}

export function errorMessage(err: unknown): string {
  const a = toAppError(err);
  if (a.code === "quiz_invalid" && a.detail) return `${a.message} ${a.detail}.`;
  return a.message;
}
