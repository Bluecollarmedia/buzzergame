import { beforeAll, describe, expect, it } from "vitest";
import { as, createQuiz, createUser, grantAccess, host, joinPlayers, makeAdmin, rpc, rpcError, startToFirstQuestion, su, submit } from "./db";
import { mcQuiz } from "./fixtures";

let admin: string;
beforeAll(async () => {
  admin = await createUser(undefined, "Admin");
  await makeAdmin(admin);
});

const newCode = (args: Record<string, unknown>) => rpc(host(admin), "admin_create_access_code", { p_duration_hours: 24, ...args });

describe("access codes", () => {
  it("launching a game requires active access", async () => {
    const h = await createUser();
    const qz = await createQuiz(h, mcQuiz(1));
    // Quizzes can be created and edited without access; launching needs it.
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("no_entitlement");
    const ent = await rpc(host(h), "my_entitlement");
    expect(ent.active).toBe(false);
  });

  it("redeems a valid code, stores only its hash and grants access", async () => {
    const h = await createUser();
    const c = await newCode({ p_duration_hours: 168, p_note: "Promo" });
    expect(c.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const stored = await as<{ code_hash: string; code_hint: string }>(su, "select code_hash, code_hint from access_codes where id = $1", [c.id]);
    expect(stored[0]!.code_hash).not.toContain(c.code.replace(/-/g, ""));
    // Codes are case- and dash-insensitive.
    const r = await rpc(host(h), "redeem_access_code", { p_code: c.code.toLowerCase().replace(/-/g, " ") });
    const hours = (Date.parse(r.expiresAt) - Date.parse(r.startsAt)) / 3600000;
    expect(Math.round(hours)).toBe(168);
    expect((await rpc(host(h), "my_entitlement")).active).toBe(true);
    expect(await rpcError(host(h), "redeem_access_code", { p_code: c.code })).toBe("code_exhausted");
    const qz = await createQuiz(h, mcQuiz(1));
    expect((await rpc(host(h), "create_session", { p_quiz_id: qz })).sessionId).toBeTruthy();
  });

  it("rejects invalid, revoked, expired and already-redeemed codes", async () => {
    const h = await createUser();
    expect(await rpcError(host(h), "redeem_access_code", { p_code: "NOPE-NOPE-NOPE" })).toBe("code_invalid");
    const revoked = await newCode({});
    await rpc(host(admin), "admin_revoke_access_code", { p_code_id: revoked.id });
    expect(await rpcError(host(h), "redeem_access_code", { p_code: revoked.code })).toBe("code_revoked");
    const expired = await newCode({ p_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await rpcError(host(h), "redeem_access_code", { p_code: expired.code })).toBe("code_expired");
    const multi = await newCode({ p_max_redemptions: 5 });
    await rpc(host(h), "redeem_access_code", { p_code: multi.code });
    expect(await rpcError(host(h), "redeem_access_code", { p_code: multi.code })).toBe("code_already_redeemed");
  });

  it("concurrent redemptions never exceed the redemption limit", async () => {
    const c = await newCode({ p_max_redemptions: 3 });
    const users = await Promise.all(Array.from({ length: 12 }, () => createUser()));
    const res = await Promise.allSettled(users.map((u) => rpc(host(u), "redeem_access_code", { p_code: c.code })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of res.filter((r) => r.status === "rejected")) {
      expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/CQ:code_exhausted/);
    }
    const [row] = await as<{ redemption_count: number }>(su, "select redemption_count from access_codes where id = $1", [c.id]);
    expect(row!.redemption_count).toBe(3);
  });

  it("new access stacks after existing access", async () => {
    const h = await createUser();
    const a = await newCode({ p_duration_hours: 24 });
    const b = await newCode({ p_duration_hours: 48 });
    const r1 = await rpc(host(h), "redeem_access_code", { p_code: a.code });
    const r2 = await rpc(host(h), "redeem_access_code", { p_code: b.code });
    expect(Date.parse(r2.startsAt)).toBe(Date.parse(r1.expiresAt));
  });

  it("admin-granted time also stacks after existing access", async () => {
    const h = await createUser();
    const a = await newCode({ p_duration_hours: 2 });
    const r1 = await rpc(host(h), "redeem_access_code", { p_code: a.code });
    await rpc(host(admin), "admin_grant_entitlement", { p_user_id: h, p_duration_hours: 10 });
    const [row] = await as<{ ends: Date }>(su, "select max(expires_at) ends from entitlements where user_id = $1 and status = 'active'", [h]);
    expect(row!.ends.getTime()).toBe(Date.parse(r1.expiresAt) + 10 * 3600 * 1000);
  });

  it("expired access blocks new games but a running game can finish", async () => {
    const h = await createUser();
    await grantAccess(h, 1);
    const qz = await createQuiz(h, mcQuiz(1));
    const s = await rpc(host(h), "create_session", { p_quiz_id: qz });
    const [p] = await joinPlayers(s.joinToken, ["Ann"]);
    const round = await startToFirstQuestion(h, s.sessionId);
    await as(su, "update entitlements set expires_at = now() - interval '1 second', starts_at = now() - interval '2 hours' where user_id = $1", [h]);
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("no_entitlement");
    expect((await submit(s.sessionId, p!, round, 0)).result).toBe("accepted");
    await rpc(host(h), "host_command", { p_session_id: s.sessionId, p_command: "close_question" });
    await rpc(host(h), "host_command", { p_session_id: s.sessionId, p_command: "next" });
    const [row] = await as<{ status: string }>(su, "select status from game_sessions where id = $1", [s.sessionId]);
    expect(row!.status).toBe("finished");
  });

  it("enforces per-code session limits", async () => {
    const h = await createUser();
    const c = await newCode({ p_max_sessions: 1 });
    await rpc(host(h), "redeem_access_code", { p_code: c.code });
    const qz = await createQuiz(h, mcQuiz(1));
    await rpc(host(h), "create_session", { p_quiz_id: qz });
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("session_limit_reached");
  });

  it("admin tools list hosts, codes, sessions and the audit log", async () => {
    const ov = await rpc(host(admin), "admin_overview");
    expect(ov.hosts).toBeGreaterThan(0);
    expect((await rpc(host(admin), "admin_list_access_codes")).length).toBeGreaterThan(0);
    expect(Array.isArray(await rpc(host(admin), "admin_list_hosts", { p_search: null }))).toBe(true);
    const log = await rpc(host(admin), "admin_audit_log", { p_limit: 20 });
    expect(log.some((e: any) => e.action === "access_code.created")).toBe(true);
    // Audit details never contain the plaintext code.
    const created = await newCode({});
    const after = await rpc(host(admin), "admin_audit_log", { p_limit: 5 });
    expect(JSON.stringify(after)).not.toContain(created.code);
  });
});
