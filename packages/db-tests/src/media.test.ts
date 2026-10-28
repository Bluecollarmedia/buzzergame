import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  anon, as, createQuiz, createUser, grantAccess, host, joinPlayers, makeAdmin, playerState, rpc, rpcError, startToFirstQuestion, su,
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

  it("no longer accepts uploads straight to the old Supabase bucket", async () => {
    const a = await createUser();
    await expect(
      as(host(a), "insert into storage.objects (bucket_id, name) values ('question-images', $1)", [`${a}/${randomUUID()}.jpg`]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("photo files", () => {
  it("hands out a fresh path in the host's own folder, and only signed-in hosts get one", async () => {
    const a = await createUser();
    const path = await rpc<string>(host(a), "reserve_question_photo");
    expect(path).toMatch(new RegExp(`^${a}/[0-9a-f-]{36}\\.jpg$`));
    expect(await rpc<string>(host(a), "reserve_question_photo", { p_ext: "png" })).toMatch(/\.png$/);
    expect(await rpcError(host(a), "reserve_question_photo", { p_ext: "gif" })).toBe("invalid_request");
    expect(await rpcError(anon, "reserve_question_photo")).toBe("permission denied for function reserve_question_photo");
  });

  it("lets hosts release only their own photos", async () => {
    const a = await createUser();
    const b = await createUser();
    const path = await rpc<string>(host(a), "reserve_question_photo");
    expect(await rpc(host(b), "release_question_photo", { p_path: path })).toBe(false);
    expect((await rpc(host(a), "my_photo_quota")).used).toBe(1);
    expect(await rpc(host(a), "release_question_photo", { p_path: path })).toBe(true);
    expect((await rpc(host(a), "my_photo_quota")).used).toBe(0);
  });

  it("releases all of a host's photos at once", async () => {
    const a = await createUser();
    const b = await createUser();
    const mine = [await rpc<string>(host(a), "reserve_question_photo"), await rpc<string>(host(a), "reserve_question_photo")];
    const theirs = await rpc<string>(host(b), "reserve_question_photo");
    expect((await rpc<string[]>(host(a), "release_all_my_photos")).sort()).toEqual(mine.sort());
    expect((await rpc(host(a), "my_photo_quota")).used).toBe(0);
    expect((await rpc(host(b), "my_photo_quota")).used).toBe(1);
    expect(await as(su, "select 1 from private.photo_files where path = $1", [theirs])).toHaveLength(1);
  });

  it("queues photos nothing uses any more, but keeps ones in quizzes and past games", async () => {
    const uid = await createUser();
    await grantAccess(uid);
    const quizId = await createQuiz(uid, mcQuiz(1));
    const used = await rpc<string>(host(uid), "reserve_question_photo");
    const inGame = await rpc<string>(host(uid), "reserve_question_photo");
    const unused = await rpc<string>(host(uid), "reserve_question_photo");
    await as(host(uid), "update questions set media = $2 where quiz_id = $1", [quizId, { type: "image", path: inGame }]);
    await rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
    await as(host(uid), "update questions set media = $2 where quiz_id = $1", [quizId, { type: "image", path: used }]);
    await as(su, "update private.photo_files set created_at = now() - interval '2 days' where owner_id = $1", [uid]);

    await as(su, "select private.queue_orphan_photos()");
    const queued = (await as<{ path: string }>(su, "select path from private.photo_trash")).map((x) => x.path);
    expect(queued).toContain(unused);
    expect(queued).not.toContain(used);
    expect(queued).not.toContain(inGame);
    // Queued photos no longer count towards the limit.
    expect((await rpc(host(uid), "my_photo_quota")).used).toBe(2);
  });

  it("lets only admins list and clear photos for the copy and clean-up", async () => {
    const h = await createUser();
    const admin = await createUser();
    await makeAdmin(admin);
    const path = await rpc<string>(host(h), "reserve_question_photo");
    for (const fn of ["admin_photo_files", "admin_photo_trash_batch"]) {
      expect(await rpcError(host(h), fn)).toBe("forbidden");
    }
    expect(await rpcError(host(h), "admin_photo_trash_done", { p_paths: [path] })).toBe("forbidden");

    const after = path.slice(0, 36);
    expect(await rpc<string[]>(host(admin), "admin_photo_files", { p_after: after, p_limit: 100 })).toContain(path);
    await as(su, "insert into private.photo_trash (path) values ($1)", [path]);
    expect(await rpc<string[]>(host(admin), "admin_photo_trash_batch", { p_limit: 200 })).toContain(path);
    await rpc(host(admin), "admin_photo_trash_done", { p_paths: [path] });
    expect(await as(su, "select 1 from private.photo_files where path = $1", [path])).toHaveLength(0);
    expect(await as(su, "select 1 from private.photo_trash where path = $1", [path])).toHaveLength(0);
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

    const photo = await rpc<string>(host(uid), "reserve_question_photo");
    await rpc(host(uid), "delete_my_account");
    expect(await as(su, "select 1 from private.photo_trash where path = $1", [photo])).toHaveLength(1);
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
  const add = (uid: string) => rpc<string>(host(uid), "reserve_question_photo");

  it("lets free accounts keep 10 photos and hosting accounts 200", async () => {
    const free = await createUser();
    for (let i = 0; i < 10; i++) await add(free);
    expect(await rpcError(host(free), "reserve_question_photo")).toBe("photo_limit");
    expect(await rpc(host(free), "my_photo_quota")).toEqual({ used: 10, limit: 10, uploadsEnabled: true });

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
