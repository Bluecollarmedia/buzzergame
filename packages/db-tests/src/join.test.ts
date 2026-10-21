import { beforeEach, describe, expect, it } from "vitest";
import {
  anon, anonFrom, as, createQuiz, createUser, grantAccess, host, joinPlayers, rpc, rpcError, secret,
  startToFirstQuestion, su,
} from "./db";
import { mcQuiz } from "./fixtures";

let uid: string;
let quizId: string;
beforeEach(async () => {
  uid = await createUser();
  await grantAccess(uid);
  quizId = await createQuiz(uid, mcQuiz(2));
});

const launch = (settings: Record<string, unknown> = {}) =>
  rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: settings });

describe("joining", () => {
  it("creates unguessable tokens and a readable room code", async () => {
    const s = await launch();
    expect(s.joinToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(s.projectorToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(s.joinToken).not.toBe(s.projectorToken);
    expect(s.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    const info = await rpc(anon, "get_join_info", { p_join_token: s.joinToken });
    expect(info).toMatchObject({ sessionId: s.sessionId, joinable: true, status: "lobby" });
    const viaCode = await rpc(anon, "resolve_room_code", { p_room_code: s.roomCode.toLowerCase().slice(0, 3) + " " + s.roomCode.slice(3) });
    expect(viaCode.joinToken).toBe(s.joinToken);
  });

  it("normalizes names and rejects bad ones", async () => {
    const s = await launch();
    const r = await rpc(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "  Ada   L  ", p_player_secret: secret() });
    expect(r.displayName).toBe("Ada L");
    for (const bad of ["", "   ", "x".repeat(25), "bell\u0007", "zero​width", "line\nbreak"]) {
      expect(await rpcError(anon, "join_session", { p_join_token: s.joinToken, p_display_name: bad, p_player_secret: secret() })).toBe("invalid_name");
    }
  });

  it("rejects duplicate names (case-insensitive) and never lets a name claim an identity", async () => {
    const s = await launch();
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    expect(await rpcError(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "ANN", p_player_secret: secret() })).toBe("name_taken");
    // Same device secret = same player (idempotent), even if a different name is sent.
    const again = await rpc(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "Someone else", p_player_secret: ann!.secret });
    expect(again).toMatchObject({ participantId: ann!.participantId, displayName: "Ann", rejoined: true });
    const [cnt] = await as<{ n: number }>(su, "select count(*)::int n from participants where session_id = $1", [s.sessionId]);
    expect(cnt!.n).toBe(1);
  });

  it("concurrent repeated joins from one device create one participant", async () => {
    const s = await launch();
    const sec = secret();
    const res = await Promise.all(Array.from({ length: 5 }, () =>
      rpc(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "Dup", p_player_secret: sec }).catch((e) => e)));
    const ids = new Set(res.filter((r) => r.participantId).map((r) => r.participantId));
    expect(ids.size).toBe(1);
  });

  it("respects the late-join setting", async () => {
    const open = await launch({ allowLateJoin: true });
    const closed = await launch({ allowLateJoin: false });
    await joinPlayers(open.joinToken, ["First"]);
    await joinPlayers(closed.joinToken, ["First"]);
    await startToFirstQuestion(uid, open.sessionId);
    await startToFirstQuestion(uid, closed.sessionId);
    await joinPlayers(open.joinToken, ["Late"]);
    expect(await rpcError(anon, "join_session", { p_join_token: closed.joinToken, p_display_name: "Late", p_player_secret: secret() })).toBe("late_join_disabled");
    const info = await rpc(anon, "get_join_info", { p_join_token: closed.joinToken });
    expect(info).toMatchObject({ joinable: false, reason: "late_join_disabled" });
  });

  it("enforces the player limit", async () => {
    const s = await launch({ maxPlayers: 2 });
    await joinPlayers(s.joinToken, ["One", "Two"]);
    expect(await rpcError(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "Three", p_player_secret: secret() })).toBe("session_full");
  });

  it("rejects unknown tokens and ended sessions", async () => {
    expect(await rpcError(anon, "get_join_info", { p_join_token: "nope".repeat(6) })).toBe("session_not_found");
    expect(await rpcError(anon, "resolve_room_code", { p_room_code: "!!" })).toBe("session_not_found");
    const s = await launch();
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "end" });
    expect(await rpcError(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "X", p_player_secret: secret() })).toBe("session_ended");
    expect(await rpcError(anon, "resolve_room_code", { p_room_code: s.roomCode })).toBe("session_not_found");
  });

  it("rate-limits room-code guessing from one address", async () => {
    const ip = "203.0.113.7";
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) {
      const code = await rpcError(anonFrom(ip), "resolve_room_code", { p_room_code: "ZZZZZZ" });
      if (code === "rate_limited") limited = true;
    }
    expect(limited).toBe(true);
  });

  it("removed players cannot rejoin or play", async () => {
    const s = await launch();
    const [p] = await joinPlayers(s.joinToken, ["Troll"]);
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "remove_player", p_args: { participantId: p!.participantId } });
    expect(await rpcError(anon, "player_state", { p_session_id: s.sessionId, p_player_secret: p!.secret })).toBe("player_removed");
    expect(await rpcError(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "Troll", p_player_secret: p!.secret })).toBe("player_removed");
  });
});
