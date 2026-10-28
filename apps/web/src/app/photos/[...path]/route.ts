import { isQuestionImagePath } from "@crowdquiz/shared";
import { r2, r2Exists, supabasePhotoUrl } from "@/lib/photos/server";

export const dynamic = "force-dynamic";

/**
 * Sends the browser (or app) on to the photo's file. Photos are in
 * Cloudflare R2; a photo that hasn't been copied there yet is still served
 * from the old Supabase bucket. File names never change, so a redirect to R2
 * can be cached for good.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!isQuestionImagePath(path)) return new Response("Not found", { status: 404 });

  const storage = r2();
  if (storage) {
    try {
      if (await r2Exists(storage, path)) {
        return redirect(`${storage.publicUrl}/${path}`, "public, max-age=31536000, immutable");
      }
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "photos.lookup_failed", message: (e as Error).message }));
    }
  }
  const old = supabasePhotoUrl(path);
  if (!old) return new Response("Not found", { status: 404 });
  return redirect(old, "public, max-age=60");
}

function redirect(to: string, cache: string) {
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": cache } });
}
