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

describe("photo limits and expiry", () => {
  const add = (uid: string) =>
    as(host(uid), "insert into storage.objects (bucket_id, name) values ('question-images', $1)", [`${uid}/${randomUUID()}.jpg`]);

  it("lets free accounts keep 10 photos and hosting accounts 200", async () => {
    const free = await createUser();
    for (let i = 0; i < 10; i++) await add(free);
    await expect(add(free)).rejects.toThrow(/row-level security/);
    expect(await rpc(host(free), "my_photo_quota")).toEqual({ used: 10, limit: 10 });

    const paid = await createUser();
    await grantAccess(paid);
    expect((await rpc(host(paid), "my_photo_quota")).limit).toBe(200);
    await add(paid);
    expect((await rpc(host(paid), "my_photo_quota")).used).toBe(1);
  });

  it("deletes old drafts and detaches old photos, queueing the files", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const stale = await createQuiz(uid, mcQuiz(1));
    const fresh = await createQuiz(uid, mcQuiz(1));
    const played = await createQuiz(uid, mcQuiz(1));
    const pStale = `${uid}/${randomUUID()}.jpg`;
    const pFresh = `${uid}/${randomUUID()}.jpg`;
    const pPlayed = `${uid}/${randomUUID()}.jpg`;
    for (const [q, p] of [[stale, pStale], [fresh, pFresh], [played, pPlayed]] as const) {
      await as(host(uid), "update questions set media = $2 where quiz_id = $1", [q, { type: "image", path: p }]);
    }
    const s = await rpc(host(uid), "create_session", { p_quiz_id: played, p_settings: {} });
    await as(su, "update game_sessions set status = 'finished', ended_at = now() - interval '31 days' where id = $1", [s.sessionId]);
    await as(su, "alter table quizzes disable trigger user");
    await as(su, "alter table questions disable trigger user");
    await as(su, "update quizzes set updated_at = now() - interval '61 days' where id = $1", [stale]);
    await as(su, "update questions set updated_at = now() - interval '61 days' where quiz_id = $1", [stale]);
    await as(su, "alter table quizzes enable trigger user");
    await as(su, "alter table questions enable trigger user");

    const r = await as<{ r: { deletedDrafts: number; detachedPhotos: number } }>(su, "select private.purge_content() r");
    expect(r[0]!.r.deletedDrafts).toBeGreaterThanOrEqual(1);
    expect(r[0]!.r.detachedPhotos).toBeGreaterThanOrEqual(1);

    expect(await as(su, "select 1 from quizzes where id = $1", [stale])).toHaveLength(0);
    expect(await as(su, "select 1 from quizzes where id = $1", [fresh])).toHaveLength(1);
    const [pq] = await as<{ media: unknown }>(su, "select media from questions where quiz_id = $1", [played]);
    expect(pq!.media).toBeNull();
    const [fq] = await as<{ media: unknown }>(su, "select media from questions where quiz_id = $1", [fresh]);
    expect(fq!.media).not.toBeNull();
    const queued = (await as<{ path: string }>(su, "select path from private.photo_trash")).map((x) => x.path);
    expect(queued).toContain(pStale);
    expect(queued).toContain(pPlayed);
    expect(queued).not.toContain(pFresh);
  });
});
