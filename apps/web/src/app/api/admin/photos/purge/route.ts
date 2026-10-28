import { RpcError, bearerToken, errorResponse, r2, r2Delete, rpcAsUser, statusFor } from "@/lib/photos/server";

export const dynamic = "force-dynamic";

/**
 * Admin only. Deletes a batch of photo files the nightly clean-up has queued
 * (expired, orphaned, or from deleted accounts). Call until `done` is true.
 */
export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return errorResponse("not_authenticated", 401);
  const storage = r2();
  if (!storage) return Response.json({ error: "not_configured" }, { status: 503 });
  try {
    const paths = await rpcAsUser<string[]>(token, "admin_photo_trash_batch", { p_limit: 50 });
    const done: string[] = [];
    await Promise.all(
      paths.map((p) =>
        r2Delete(storage, p)
          .then(() => done.push(p))
          .catch((e: Error) => console.error(JSON.stringify({ level: "error", event: "photos.purge_failed", message: e.message }))),
      ),
    );
    if (done.length) await rpcAsUser(token, "admin_photo_trash_done", { p_paths: done });
    return Response.json(
      { deleted: done.length, failed: paths.length - done.length, done: paths.length === 0 || done.length === 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const code = e instanceof RpcError ? e.message : "CQ:internal";
    return errorResponse(code, statusFor(code));
  }
}
