import { describe, expect, it } from "vitest";
import { as, createQuiz, createUser, grantAccess, host, joinPlayers, rpc, su } from "./db";
import { mcQuiz } from "./fixtures";

describe("data retention", () => {
  it("cancels idle games and deletes old finished games with their guest data", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(1));
    const old = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    const idle = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    const recent = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    await joinPlayers(old.joinToken, ["Ann"]);
    await joinPlayers(recent.joinToken, ["Ben"]);

    await as(su, "update game_sessions set status = 'finished', ended_at = now() - interval '91 days' where id = $1", [old.sessionId]);
    await as(su, "update game_sessions set status = 'finished', ended_at = now() - interval '10 days' where id = $1", [recent.sessionId]);
    await as(su, "alter table game_sessions disable trigger user");
    await as(su, "update game_sessions set updated_at = now() - interval '25 hours' where id = $1", [idle.sessionId]);
    await as(su, "alter table game_sessions enable trigger user");

    const r = await as<{ r: { deletedSessions: number; abortedIdle: number } }>(su, "select private.purge_expired_data() r");
    expect(r[0]!.r.deletedSessions).toBeGreaterThanOrEqual(1);
    expect(r[0]!.r.abortedIdle).toBeGreaterThanOrEqual(1);

    const rows = await as<{ id: string; status: string }>(su, "select id, status from game_sessions where id = any($1)", [
      [old.sessionId, idle.sessionId, recent.sessionId],
    ]);
    expect(rows.find((x) => x.id === old.sessionId)).toBeUndefined();
    expect(rows.find((x) => x.id === idle.sessionId)?.status).toBe("aborted");
    expect(rows.find((x) => x.id === recent.sessionId)?.status).toBe("finished");
    const players = await as<{ n: number }>(su, "select count(*)::int n from participants where session_id = $1", [old.sessionId]);
    expect(players[0]!.n).toBe(0);
  });

  it("is not callable through the API", async () => {
    const uid = await createUser();
    await expect(as(host(uid), "select private.purge_expired_data()")).rejects.toThrow();
  });
});
