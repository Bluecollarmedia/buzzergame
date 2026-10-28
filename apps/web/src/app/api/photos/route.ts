import { isQuestionImagePath } from "@crowdquiz/shared";
import {
  RpcError, bearerToken, errorResponse, r2, r2Delete, r2Put, rpcAsUser, sniffImage, statusFor,
} from "@/lib/photos/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;

function fail(e: unknown) {
  if (e instanceof RpcError) return errorResponse(e.message, statusFor(e.message));
  console.error(JSON.stringify({ level: "error", event: "photos.error", message: (e as Error).message }));
  return errorResponse("photo_upload_failed", 502);
}

/**
 * Stores a new question photo. The app sends the resized image as the body
 * with the host's sign-in token; the database checks the limit and the
 * Photo uploads switch and picks the file name. Returns { path }.
 */
export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return errorResponse("not_authenticated", 401);
  const storage = r2();
  if (!storage) return errorResponse("photo_upload_failed", 503);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return errorResponse("invalid_request", 413);
  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return errorResponse("invalid_request", 413);
  const kind = sniffImage(new Uint8Array(body, 0, Math.min(16, body.byteLength)));
  if (!kind) return errorResponse("invalid_request", 415);

  let path: string;
  try {
    path = await rpcAsUser<string>(token, "reserve_question_photo", { p_ext: kind.ext });
  } catch (e) {
    return fail(e);
  }
  try {
    await r2Put(storage, path, body, kind.type);
  } catch (e) {
    // Give the slot back so a failed upload doesn't count towards the limit.
    await rpcAsUser(token, "release_question_photo", { p_path: path }).catch(() => {});
    return fail(e);
  }
  return Response.json({ path }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Deletes one of the host's photos (?path=<host id>/<id>.jpg), or all of
 * them (?all=1, used just before the account is deleted).
 */
export async function DELETE(req: Request) {
  const token = bearerToken(req);
  if (!token) return errorResponse("not_authenticated", 401);
  const storage = r2();
  if (!storage) return errorResponse("photo_upload_failed", 503);
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const one = url.searchParams.get("path");
  if (!all && !isQuestionImagePath(one)) return errorResponse("invalid_request", 400);

  let paths: string[];
  try {
    if (all) {
      paths = await rpcAsUser<string[]>(token, "release_all_my_photos");
    } else {
      paths = (await rpcAsUser<boolean>(token, "release_question_photo", { p_path: one })) ? [one!] : [];
    }
  } catch (e) {
    return fail(e);
  }
  let deleted = 0;
  for (const p of paths) {
    // A file that can't be deleted now is left over; the database no longer
    // counts it, and it is unreachable without its random name.
    await r2Delete(storage, p).then(() => deleted++).catch((e: Error) => {
      console.error(JSON.stringify({ level: "error", event: "photos.delete_failed", message: e.message }));
    });
  }
  return Response.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
