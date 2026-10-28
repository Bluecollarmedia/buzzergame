import * as ImagePicker from "expo-image-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { errorMessage } from "@crowdquiz/shared";
import { config } from "./config";
import { getSupabase } from "./supabase";
import type { QuestionMedia } from "./types";

const MAX_SIDE = 1280;
const FREE_PHOTOS = 10;

/**
 * Photos are stored in Cloudflare R2 through the website's /api/photos
 * route, which checks the host's sign-in, photo limit and the Photo uploads
 * switch before storing the file.
 */
async function photosApi(init: RequestInit & { query?: string }): Promise<Response> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  if (!config.siteUrl) throw new Error("Couldn't upload the photo. Check your connection and try again.");
  const base = config.siteUrl.replace(/\/+$/, "");
  return fetch(`${base}/api/photos${init.query ?? ""}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
}

/**
 * Lets the host choose a photo, shrinks it, and uploads it to their own folder.
 * Returns null if they cancel. The picker is the system photo sheet, so the
 * app never gets access to the rest of the photo library.
 */
export async function pickQuestionPhoto(): Promise<QuestionMedia | null> {
  const quota = await getSupabase().rpc("my_photo_quota");
  const q = quota.data as { used: number; limit: number; uploadsEnabled?: boolean } | null;
  if (q && q.uploadsEnabled === false) {
    throw new Error("Photo uploads are turned off right now.");
  }
  if (q && q.used >= q.limit) {
    throw new Error(
      q.limit <= FREE_PHOTOS
        ? `Free accounts can keep ${q.limit} photos. Remove a photo you don't need, then try again.`
        : `You've reached ${q.limit} photos. Remove a photo you don't need, then try again.`,
    );
  }
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const resize = asset.width >= asset.height ? { width: Math.min(MAX_SIDE, asset.width) } : { height: Math.min(MAX_SIDE, asset.height) };
  const out = await manipulateAsync(asset.uri, [{ resize }], { compress: 0.7, format: SaveFormat.JPEG });
  const bytes = await (await fetch(out.uri)).arrayBuffer();

  let res: Response;
  try {
    res = await photosApi({ method: "POST", body: bytes, headers: { "Content-Type": "image/jpeg" } });
  } catch (e) {
    if (e instanceof Error && e.message === "Please sign in again.") throw e;
    throw new Error("Couldn't upload the photo. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { path?: string; error?: string } | null;
  if (!res.ok || !body?.path) {
    throw new Error(body?.error ? errorMessage(new Error(body.error)) : "Couldn't upload the photo. Check your connection and try again.");
  }
  return { type: "image", path: body.path };
}

/** Removes a photo that is no longer used by any question. */
export async function deleteQuestionPhoto(path: string) {
  await photosApi({ method: "DELETE", query: `?path=${encodeURIComponent(path)}` }).catch(() => {});
}

/** Removes all of the host's photos, just before their account is deleted. */
export async function deleteAllMyPhotos() {
  await photosApi({ method: "DELETE", query: "?all=1" });
}
