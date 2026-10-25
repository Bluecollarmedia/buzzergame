import * as ImagePicker from "expo-image-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { uuidv4 } from "@crowdquiz/shared";
import { getSupabase } from "./supabase";
import type { QuestionMedia } from "./types";

const MAX_SIDE = 1280;
const FREE_PHOTOS = 10;

/**
 * Lets the host choose a photo, shrinks it, and uploads it to their own folder.
 * Returns null if they cancel. The picker is the system photo sheet, so the
 * app never gets access to the rest of the photo library.
 */
export async function pickQuestionPhoto(userId: string): Promise<QuestionMedia | null> {
  const quota = await getSupabase().rpc("my_photo_quota");
  const q = quota.data as { used: number; limit: number } | null;
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
  const path = `${userId}/${uuidv4()}.jpg`;
  const { error } = await getSupabase().storage.from("question-images").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("Couldn't upload the photo. Check your connection and try again.");
  return { type: "image", path };
}

/** Removes a photo that is no longer used by any question. */
export async function deleteQuestionPhoto(path: string) {
  await getSupabase().storage.from("question-images").remove([path]).catch(() => {});
}
