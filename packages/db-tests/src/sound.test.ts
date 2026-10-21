import { describe, expect, it } from "vitest";
import { createQuiz, createUser, grantAccess, host, joinPlayers, playerState, rpc, rpcError } from "./db";
import { mcQuiz } from "./fixtures";

describe("projector sound", () => {
  it("defaults on, can be muted by the host only, and bumps the state version", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(1));
    const s = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    const [p] = await joinPlayers(s.joinToken, ["Ann"]);
    const before = await playerState(s.sessionId, p!);
    expect(before.session.settings.soundOn).toBe(true);

    const r = await rpc(host(uid), "host_set_sound", { p_session_id: s.sessionId, p_on: false });
    expect(r.soundOn).toBe(false);
    const after = await playerState(s.sessionId, p!);
    expect(after.session.settings.soundOn).toBe(false);
    expect(after.session.stateVersion).toBeGreaterThan(before.session.stateVersion);

    const other = await createUser();
    expect(await rpcError(host(other), "host_set_sound", { p_session_id: s.sessionId, p_on: true })).toBe("not_found");
  });

  it("respects soundOn chosen at launch", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(1));
    const s = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: { soundOn: false } });
    const [p] = await joinPlayers(s.joinToken, ["Ben"]);
    expect((await playerState(s.sessionId, p!)).session.settings.soundOn).toBe(false);
  });
});
