import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  anon, as, createQuiz, createUser, grantAccess, host, joinPlayers, playerState, rpc, rpcError, startToFirstQuestion, su,
} from "./db";
import { mcQuiz } from "./fixtures";

describe("photo questions", () => {
  it("accepts only well-formed image paths", async () => {
    const uid = await createUser();
    const quizId = await createQuiz(uid, mcQuiz(1));
    const [q] = await as<{ id: string }>(host(uid), "select id from questions where quiz_id = $1", [quizId]);
    const path = `${uid}/${randomUUID()}.jpg`;
    await as(host(uid), "update questions set media = $2 where id = $1", [q!.id, { type: "image", path }]);
    await expect(
      as(host(uid), "update questions set media = $2 where id = $1", [q!.id, { type: "image", path: "../../etc/passwd" }]),
    ).rejects.toThrow(/questions_media_shape/);
    await expect(
      as(host(uid), "update questions set media = $2 where id = $1", [q!.id, { type: "video", path }]),
    ).rejects.toThrow(/questions_media_shape/);
  });

  it("copies the photo into the game and shows it to the projector and host, not to players", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(1));
    const path = `${uid}/${randomUUID()}.png`;
    await as(host(uid), "update questions set media = $2 where quiz_id = $1", [quizId, { type: "image", path }]);
    const s = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    const [p] = await joinPlayers(s.joinToken, ["Ann"]);
    await startToFirstQuestion(uid, s.sessionId);

    expect((await rpc(host(uid), "host_state", { p_session_id: s.sessionId })).question.imagePath).toBe(path);
    expect((await rpc(anon, "projector_state", { p_projector_token: s.projectorToken })).question.imagePath).toBe(path);
    expect((await playerState(s.sessionId, p!)).question.imagePath).toBeNull();

    // Editing the quiz afterwards never changes a game that already exists.
    await as(host(uid), "update questions set media = null where quiz_id = $1", [quizId]);
    expect((await rpc(anon, "projector_state", { p_projector_token: s.projectorToken })).question.imagePath).toBe(path);
  });

  it("only lets hosts write to their own folder of the question-images bucket", async () => {
    const a = await createUser();
    const b = await createUser();
    const ok = `${a}/${randomUUID()}.jpg`;
    await as(host(a), "insert into storage.objects (bucket_id, name) values ('question-images', $1)", [ok]);
    await expect(
      as(host(b), "insert into storage.objects (bucket_id, name) values ('question-images', $1)", [`${a}/${randomUUID()}.jpg`]),
    ).rejects.toThrow(/row-level security/);
    await as(host(b), "delete from storage.objects where name = $1", [ok]);
    const left = await as(su, "select 1 from storage.objects where name = $1", [ok]);
    expect(left).toHaveLength(1);
  });
});

describe("account deletion", () => {
  it("removes the host and everything they own, and needs a signed-in user", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(2));
    const s = await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    await joinPlayers(s.joinToken, ["Ann"]);

    expect(await rpcError(anon, "delete_my_account")).toBe("permission denied for function delete_my_account");

    await rpc(host(uid), "delete_my_account");
    for (const sql of [
      "select 1 from auth.users where id = $1",
      "select 1 from public.quizzes where owner_id = $1",
      "select 1 from public.game_sessions where host_id = $1",
      "select 1 from public.entitlements where user_id = $1",
      "select 1 from public.profiles where id = $1",
    ]) {
      expect(await as(su, sql, [uid])).toHaveLength(0);
    }
    expect(await as(su, "select 1 from public.participants where session_id = $1", [s.sessionId])).toHaveLength(0);
  });
});
