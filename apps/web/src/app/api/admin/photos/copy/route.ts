import {
  RpcError, bearerToken, errorResponse, r2, r2Exists, r2Put, rpcAsUser, sniffImage, statusFor, supabasePhotoUrl,
} from "@/lib/photos/server";

export const dynamic = "force-dynamic";

/**
 * Admin only. Copies a batch of photos from the old Supabase bucket to R2,
 * skipping any already there. Send { after } from the previous answer's
 * `next` until `done` is true. Safe to run again at any time.
 */
export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return errorResponse("not_authenticated", 401);
  const storage = r2();
  if (!storage) return Response.json({ error: "not_configured" }, { status: 503 });
  const { after } = ((await req.json().catch(() => ({}))) ?? {}) as { after?: string };

  let paths: string[];
  try {
    paths = await rpcAsUser<string[]>(token, "admin_photo_files", { p_after: typeof after === "string" ? after : "", p_limit: 20 });
  } catch (e) {
    const code = e instanceof RpcError ? e.message : "CQ:internal";
    return errorResponse(code, statusFor(code));
  }

  let copied = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;
  await Promise.all(
    paths.map(async (path) => {
      try {
        if (await r2Exists(storage, path)) {
          skipped++;
          return;
        }
        const src = supabasePhotoUrl(path);
        const res = src ? await fetch(src, { cache: "no-store", signal: AbortSignal.timeout(10000) }) : null;
        if (!res || res.status === 404 || res.status === 400) {
          missing++;
          return;
        }
        if (!res.ok) throw new Error(`Supabase GET ${res.status}`);
        const body = await res.arrayBuffer();
        const kind = sniffImage(new Uint8Array(body, 0, Math.min(16, body.byteLength)));
        await r2Put(storage, path, body, kind?.type ?? "image/jpeg");
        copied++;
      } catch (e) {
        failed++;
        console.error(JSON.stringify({ level: "error", event: "photos.copy_failed", message: (e as Error).message }));
      }
    }),
  );
  const next = paths.length ? paths[paths.length - 1] : null;
  return Response.json({ copied, skipped, missing, failed, next, done: paths.length === 0 }, { headers: { "Cache-Control": "no-store" } });
}
