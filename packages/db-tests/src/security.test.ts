import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anon, as, createQuiz, createUser, grantAccess, host, joinPlayers, playerState, rpc, rpcError,
  secret, startToFirstQuestion, su,
} from "./db";
import { mcQuiz } from "./fixtures";

let alice: string;
let bob: string;
let aliceQuiz: string;
let session: { sessionId: string; joinToken: string; projectorToken: string };

beforeAll(async () => {
  alice = await createUser(undefined, "Alice");
  bob = await createUser(undefined, "Bob");
  await grantAccess(alice);
  await grantAccess(bob);
  aliceQuiz = await createQuiz(alice, mcQuiz(2));
  session = await rpc(host(alice), "create_session", { p_quiz_id: aliceQuiz });
});

describe("tenant isolation", () => {
  it("a host cannot see, edit or delete another host's quizzes", async () => {
    expect(await as(host(bob), "select * from quizzes where id = $1", [aliceQuiz])).toHaveLength(0);
    expect(await as(host(bob), "select * from questions where quiz_id = $1", [aliceQuiz])).toHaveLength(0);
    await as(host(bob), "update quizzes set title = 'pwned' where id = $1", [aliceQuiz]);
    await as(host(bob), "delete from quizzes where id = $1", [aliceQuiz]);
    const [q] = await as<{ title: string }>(su, "select title from quizzes where id = $1", [aliceQuiz]);
    expect(q!.title).toBe("Test quiz");
    await expect(as(host(bob), "insert into questions (quiz_id, position) values ($1, 99)", [aliceQuiz])).rejects.toThrow(/row-level security/);
    await expect(as(host(bob), "insert into quizzes (owner_id, title, mode) values ($1, 'x', 'multiple_choice')", [alice])).rejects.toThrow(/row-level security/);
    expect(await rpcError(host(bob), "duplicate_quiz", { p_quiz_id: aliceQuiz })).toBe("not_found");
    expect(await rpcError(host(bob), "create_session", { p_quiz_id: aliceQuiz })).toBe("not_found");
  });

  it("a host cannot read or control another host's session", async () => {
    expect(await as(host(bob), "select * from game_sessions where id = $1", [session.sessionId])).toHaveLength(0);
    expect(await rpcError(host(bob), "host_state", { p_session_id: session.sessionId })).toBe("not_found");
    expect(await rpcError(host(bob), "host_command", { p_session_id: session.sessionId, p_command: "end" })).toBe("not_found");
    expect(await rpcError(host(bob), "session_results", { p_session_id: session.sessionId })).toBe("not_found");
  });

  it("hosts cannot write gameplay records or scores directly", async () => {
    await expect(as(host(alice), "insert into score_events (session_id, round_id, participant_id, points, reason) values ($1, $2, $3, 100, 'correct')",
      [session.sessionId, randomUUID(), randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(as(host(alice), "update game_sessions set status = 'finished' where id = $1", [session.sessionId])).rejects.toThrow(/permission denied/);
    await expect(as(host(alice), "insert into entitlements (user_id, expires_at, source) values ($1, now() + interval '100 years', 'admin')", [alice])).rejects.toThrow(/permission denied/);
    await expect(as(host(alice), "insert into admin_users (user_id) values ($1)", [alice])).rejects.toThrow(/permission denied/);
    await expect(as(host(alice), "update profiles set disabled = false where id = $1", [alice])).rejects.toThrow(/permission denied/);
  });

  it("hosts never see player secret hashes", async () => {
    await joinPlayers(session.joinToken, ["Zed"]);
    await expect(as(host(alice), "select secret_hash from participants")).rejects.toThrow(/permission denied/);
    const rows = await as(host(alice), "select id, display_name from participants where session_id = $1", [session.sessionId]);
    expect(rows).toHaveLength(1);
  });

  it("anonymous clients have no table access at all", async () => {
    for (const t of ["quizzes", "questions", "game_sessions", "session_questions", "participants", "answers", "score_events", "access_codes", "entitlements", "audit_log", "profiles"]) {
      await expect(as(anon, `select * from ${t} limit 1`)).rejects.toThrow(/permission denied/);
    }
    await expect(as(anon, "select private.leaderboard($1)", [session.sessionId])).rejects.toThrow(/permission denied/);
  });

  it("anonymous clients cannot call host or admin functions", async () => {
    await expect(rpc(anon, "create_session", { p_quiz_id: aliceQuiz })).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "host_command", { p_session_id: session.sessionId, p_command: "end" })).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "admin_overview")).rejects.toThrow(/permission denied/);
  });

  it("non-admin hosts cannot use admin functions", async () => {
    expect(await rpcError(host(alice), "admin_overview")).toBe("forbidden");
    expect(await rpcError(host(alice), "admin_create_access_code", { p_duration_hours: 24 })).toBe("forbidden");
    expect(await rpcError(host(alice), "admin_list_hosts")).toBe("forbidden");
  });
});

describe("player credentials", () => {
  it("rejects unknown secrets, malformed secrets and secrets from another session", async () => {
    const other = await rpc(host(alice), "create_session", { p_quiz_id: aliceQuiz });
    const [p] = await joinPlayers(other.joinToken, ["Yan"]);
    expect(await rpcError(anon, "player_state", { p_session_id: session.sessionId, p_player_secret: p!.secret })).toBe("invalid_player");
    expect(await rpcError(anon, "player_state", { p_session_id: session.sessionId, p_player_secret: secret() })).toBe("invalid_player");
    expect(await rpcError(anon, "player_state", { p_session_id: session.sessionId, p_player_secret: "short" })).toBe("invalid_player");
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: session.sessionId, p_player_secret: p!.secret, p_round_id: randomUUID(), p_choice_index: 0, p_submission_id: randomUUID(),
    })).toBe("invalid_player");
  });

  it("the projector token is read-only and the correct answer stays hidden while open", async () => {
    const s = await rpc(host(alice), "create_session", { p_quiz_id: aliceQuiz });
    await joinPlayers(s.joinToken, ["Ann"]);
    await startToFirstQuestion(alice, s.sessionId);
    const proj = await rpc(anon, "projector_state", { p_projector_token: s.projectorToken });
    expect(proj.question.prompt).toBe("Question 1?");
    expect(proj.question.correctIndex).toBeNull();
    expect(proj.question.distribution).toBeNull();
    expect(JSON.stringify(proj)).not.toContain(s.projectorToken);
    expect(JSON.stringify(proj)).not.toMatch(/secret|host_id|email/i);
    // Knowing the projector token does not grant host commands.
    expect(await rpcError(anon, "projector_state", { p_projector_token: "x".repeat(24) })).toBe("session_not_found");
  });

  it("player state never contains other players' data or the question text", async () => {
    const s = await rpc(host(alice), "create_session", { p_quiz_id: aliceQuiz });
    const [ann] = await joinPlayers(s.joinToken, ["Ann", "Ben"]);
    await startToFirstQuestion(alice, s.sessionId);
    const ps = await playerState(s.sessionId, ann!);
    const text = JSON.stringify(ps);
    expect(text).not.toContain("Question 1?");
    expect(text).not.toContain("Ben");
    expect(text).not.toContain(s.joinToken);
    expect(ps.question.correctIndex).toBeNull();
  });
});

describe("disabled accounts", () => {
  it("a disabled host cannot launch games and their live sessions are cancelled", async () => {
    const admin = await createUser(undefined, "Admin");
    await as(su, "insert into admin_users (user_id) values ($1)", [admin]);
    const evil = await createUser(undefined, "Evil");
    await grantAccess(evil);
    const qz = await createQuiz(evil, mcQuiz(1));
    const s = await rpc(host(evil), "create_session", { p_quiz_id: qz });
    await rpc(host(admin), "admin_set_host_disabled", { p_user_id: evil, p_disabled: true, p_reason: "spam" });
    expect(await rpcError(host(evil), "create_session", { p_quiz_id: qz })).toBe("account_disabled");
    const [row] = await as<{ status: string }>(su, "select status from game_sessions where id = $1", [s.sessionId]);
    expect(row!.status).toBe("aborted");
    const [audit] = await as<{ n: number }>(su, "select count(*)::int n from audit_log where action = 'host.disabled'");
    expect(audit!.n).toBeGreaterThan(0);
  });
});
