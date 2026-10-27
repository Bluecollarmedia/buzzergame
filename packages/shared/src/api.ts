import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "./errors";
import type { HostCommand } from "./stateMachine";
import type {
  EntitlementStatus,
  HostState,
  JoinInfo,
  JoinResult,
  PlayerState,
  ProjectorState,
  SessionResults,
  SubmitResult,
} from "./types";

// The client is typed loosely so this package does not depend on generated
// database types; every call is wrapped with an explicit result type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

async function rpc<T>(sb: AnyClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw toAppError(error);
  // Some RPCs return {"error": "<code>"} instead of raising (see
  // private.soft_error in the migrations). Treat them as errors.
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    throw toAppError({ message: `CQ:${(data as { error: string }).error}` });
  }
  return data as T;
}

/** Typed wrappers for every RPC used by players, projectors and hosts. */
export function createGameApi(sb: AnyClient) {
  return {
    serverTime: () => rpc<string>(sb, "server_time"),

    // Players
    getJoinInfo: (joinToken: string) => rpc<JoinInfo>(sb, "get_join_info", { p_join_token: joinToken }),
    resolveRoomCode: (roomCode: string) =>
      rpc<{ joinToken: string; sessionId: string; title: string }>(sb, "resolve_room_code", {
        p_room_code: roomCode,
      }),
    join: (joinToken: string, displayName: string, secret: string) =>
      rpc<JoinResult>(sb, "join_session", {
        p_join_token: joinToken,
        p_display_name: displayName,
        p_player_secret: secret,
      }),
    playerState: (sessionId: string, secret: string) =>
      rpc<PlayerState>(sb, "player_state", { p_session_id: sessionId, p_player_secret: secret }),
    submitAnswer: (sessionId: string, secret: string, roundId: string, choiceIndex: number, submissionId: string) =>
      rpc<SubmitResult>(sb, "submit_answer", {
        p_session_id: sessionId,
        p_player_secret: secret,
        p_round_id: roundId,
        p_choice_index: choiceIndex,
        p_submission_id: submissionId,
      }),
    tick: (sessionId: string) =>
      rpc<{ status: string; stateVersion: number; transitions: number }>(sb, "tick_session", {
        p_session_id: sessionId,
      }),

    // Projector
    projectorState: (projectorToken: string) =>
      rpc<ProjectorState>(sb, "projector_state", { p_projector_token: projectorToken }),

    // Host
    createSession: (quizId: string, settings: Record<string, unknown> = {}) =>
      rpc<{ sessionId: string; roomCode: string; joinToken: string; projectorToken: string }>(
        sb,
        "create_session",
        { p_quiz_id: quizId, p_settings: settings },
      ),
    hostState: (sessionId: string) => rpc<HostState>(sb, "host_state", { p_session_id: sessionId }),
    hostCommand: (
      sessionId: string,
      command: HostCommand,
      expectedVersion: number | null,
      args: Record<string, unknown> = {},
    ) =>
      rpc<{ applied: boolean; reason?: string; stateVersion: number; status: string }>(sb, "host_command", {
        p_session_id: sessionId,
        p_command: command,
        p_expected_version: expectedVersion,
        p_args: args,
      }),
    setProjectorSound: (sessionId: string, on: boolean) =>
      rpc<{ soundOn: boolean; stateVersion: number }>(sb, "host_set_sound", { p_session_id: sessionId, p_on: on }),
    sessionResults: (sessionId: string) =>
      rpc<SessionResults>(sb, "session_results", { p_session_id: sessionId }),
    deleteSession: (sessionId: string) => rpc<void>(sb, "delete_session", { p_session_id: sessionId }),

    // Quiz editing helpers
    addQuestion: (quizId: string, afterPosition: number | null = null) =>
      rpc<Record<string, unknown>>(sb, "add_question", { p_quiz_id: quizId, p_after_position: afterPosition }),
    duplicateQuestion: (questionId: string) =>
      rpc<Record<string, unknown>>(sb, "duplicate_question", { p_question_id: questionId }),
    deleteQuestion: (questionId: string) => rpc<void>(sb, "delete_question", { p_question_id: questionId }),
    reorderQuestions: (quizId: string, ids: string[]) =>
      rpc<void>(sb, "reorder_questions", { p_quiz_id: quizId, p_question_ids: ids }),
    duplicateQuiz: (quizId: string) => rpc<string>(sb, "duplicate_quiz", { p_quiz_id: quizId }),
    quizIssues: (quizId: string) => rpc<string[]>(sb, "quiz_issues", { p_quiz_id: quizId }),

    // Account
    deleteMyAccount: () => rpc<void>(sb, "delete_my_account"),

    // Access
    myEntitlement: () => rpc<EntitlementStatus>(sb, "my_entitlement"),
    myPhotoQuota: () => rpc<PhotoQuota>(sb, "my_photo_quota"),
    redeemAccessCode: (code: string) =>
      rpc<{ entitlementId: string; plan: string; startsAt: string; expiresAt: string }>(sb, "redeem_access_code", {
        p_code: code,
      }),

    // Admin
    admin: {
      getSettings: () => rpc<AppSettings>(sb, "admin_get_settings"),
      updateSettings: (changes: { freeHosting?: boolean; photoUploads?: boolean }) =>
        rpc<AppSettings>(sb, "admin_update_settings", {
          p_free_hosting: changes.freeHosting ?? null,
          p_photo_uploads: changes.photoUploads ?? null,
        }),
      overview: () => rpc<Record<string, number | string>>(sb, "admin_overview"),
      listHosts: (search?: string) => rpc<AdminHost[]>(sb, "admin_list_hosts", { p_search: search ?? null }),
      setHostDisabled: (userId: string, disabled: boolean, reason?: string) =>
        rpc<void>(sb, "admin_set_host_disabled", { p_user_id: userId, p_disabled: disabled, p_reason: reason ?? null }),
      grantEntitlement: (userId: string, hours: number, plan = "standard") =>
        rpc<string>(sb, "admin_grant_entitlement", { p_user_id: userId, p_duration_hours: hours, p_plan: plan }),
      revokeEntitlements: (userId: string) => rpc<number>(sb, "admin_revoke_entitlements", { p_user_id: userId }),
      createAccessCode: (input: {
        durationHours: number;
        maxRedemptions: number;
        expiresAt: string | null;
        plan?: string;
        note?: string | null;
        maxSessions?: number | null;
        code?: string | null;
      }) =>
        rpc<{ id: string; code: string }>(sb, "admin_create_access_code", {
          p_duration_hours: input.durationHours,
          p_max_redemptions: input.maxRedemptions,
          p_expires_at: input.expiresAt,
          p_plan: input.plan ?? "standard",
          p_note: input.note ?? null,
          p_max_sessions: input.maxSessions ?? null,
          p_code: input.code ?? null,
        }),
      listAccessCodes: () => rpc<AdminAccessCode[]>(sb, "admin_list_access_codes"),
      revokeAccessCode: (id: string) => rpc<void>(sb, "admin_revoke_access_code", { p_code_id: id }),
      listSessions: (liveOnly = true) => rpc<AdminSession[]>(sb, "admin_list_sessions", { p_live_only: liveOnly }),
      endSession: (id: string) => rpc<void>(sb, "admin_end_session", { p_session_id: id }),
      auditLog: (limit = 100) => rpc<AdminAuditEntry[]>(sb, "admin_audit_log", { p_limit: limit }),
    },
  };
}

export type GameApi = ReturnType<typeof createGameApi>;

/** App-wide switches set in the Admin tab. */
export interface AppSettings {
  /** Anyone signed in can host without an access code. */
  freeHosting: boolean;
  /** Hosts can upload new question photos. */
  photoUploads: boolean;
  updatedAt: string | null;
}

export interface PhotoQuota {
  used: number;
  limit: number;
  /** False while an admin has turned photo uploads off for everyone. */
  uploadsEnabled?: boolean;
}

export interface AdminHost {
  id: string;
  email: string;
  displayName: string | null;
  disabled: boolean | null;
  disabledReason: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  isAdmin: boolean;
  accessExpiresAt: string | null;
  quizCount: number;
  sessionCount: number;
}

export interface AdminAccessCode {
  id: string;
  hint: string;
  plan: string;
  durationHours: number;
  maxRedemptions: number;
  redemptionCount: number;
  maxSessions: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
  createdAt: string;
  status: "active" | "revoked" | "expired" | "redeemed";
}

export interface AdminSession {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  hostEmail: string;
  playerCount: number;
}

export interface AdminAuditEntry {
  id: number;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  sessionId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}
