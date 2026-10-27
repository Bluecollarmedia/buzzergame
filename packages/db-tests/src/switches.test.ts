import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { as, createQuiz, createUser, grantAccess, host, makeAdmin, rpc, rpcError } from "./db";
import { mcQuiz } from "./fixtures";

let admin: string;
beforeAll(async () => {
  admin = await createUser(undefined, "Admin");
  await makeAdmin(admin);
});

const set = (changes: Record<string, boolean>) => rpc(host(admin), "admin_update_settings", changes);
const addPhoto = (uid: string) =>
  as(host(uid), "insert into storage.objects (bucket_id, name) values ('question-images', $1)", [`${uid}/${randomUUID()}.jpg`]);

// Other test files share the database, so always put the defaults back.
afterEach(async () => {
  await set({ p_free_hosting: false, p_photo_uploads: true });
});

describe("admin switches", () => {
  it("only admins can read or change them", async () => {
    const h = await createUser();
    expect(await rpcError(host(h), "admin_get_settings")).toBe("forbidden");
    expect(await rpcError(host(h), "admin_update_settings", { p_free_hosting: true })).toBe("forbidden");
    expect(await rpc(host(admin), "admin_get_settings")).toMatchObject({ freeHosting: false, photoUploads: true });
  });

  it("free hosting lets anyone host without a code, and turning it off brings codes back", async () => {
    const h = await createUser();
    const qz = await createQuiz(h, mcQuiz(1));
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("no_entitlement");

    expect(await set({ p_free_hosting: true })).toMatchObject({ freeHosting: true, photoUploads: true });
    const ent = await rpc(host(h), "my_entitlement");
    expect(ent).toMatchObject({ active: true, freeHosting: true });
    expect((await rpc(host(h), "create_session", { p_quiz_id: qz })).sessionId).toBeTruthy();
    expect((await rpc(host(h), "my_photo_quota")).limit).toBe(200);

    await set({ p_free_hosting: false });
    expect((await rpc(host(h), "my_entitlement")).active).toBe(false);
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("no_entitlement");
  });

  it("free hosting lifts the game limit on a code", async () => {
    const h = await createUser();
    const c = await rpc(host(admin), "admin_create_access_code", { p_duration_hours: 24, p_max_sessions: 1 });
    await rpc(host(h), "redeem_access_code", { p_code: c.code });
    const qz = await createQuiz(h, mcQuiz(1));
    await rpc(host(h), "create_session", { p_quiz_id: qz });
    expect(await rpcError(host(h), "create_session", { p_quiz_id: qz })).toBe("session_limit_reached");
    await set({ p_free_hosting: true });
    expect((await rpc(host(h), "my_entitlement")).maxSessions).toBeNull();
    expect((await rpc(host(h), "create_session", { p_quiz_id: qz })).sessionId).toBeTruthy();
  });

  it("turning photo uploads off blocks everyone, admins included", async () => {
    const free = await createUser();
    const paid = await createUser();
    await grantAccess(paid);
    await set({ p_photo_uploads: false, p_free_hosting: true });
    for (const uid of [free, paid, admin]) {
      await expect(addPhoto(uid)).rejects.toThrow(/row-level security/);
      expect(await rpc(host(uid), "my_photo_quota")).toMatchObject({ limit: 0, uploadsEnabled: false });
    }
    // Changing one switch leaves the other alone.
    expect(await set({ p_free_hosting: false })).toMatchObject({ freeHosting: false, photoUploads: false });
    await set({ p_photo_uploads: true });
    await addPhoto(free);
    expect(await rpc(host(free), "my_photo_quota")).toMatchObject({ used: 1, limit: 10, uploadsEnabled: true });
  });

  it("records each change in the audit log", async () => {
    await set({ p_photo_uploads: false });
    const log = await rpc(host(admin), "admin_audit_log", { p_limit: 5 });
    expect(log.map((e: { action: string }) => e.action)).toContain("settings.photo_uploads_off");
  });
});
