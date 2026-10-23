import * as ImagePicker from "expo-image-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { uuidv4 } from "@crowdquiz/shared";
import { getSupabase } from "./supabase";
import type { QuestionMedia } from "./types";

const MAX_SIDE = 1600;

/**
 * Lets the host choose a photo, shrinks it, and uploads it to their own folder.
 * Returns null if they cancel. The picker is the system photo sheet, so the
 * app never gets access to the rest of the photo library.
 */
export async function pickQuestionPhoto(userId: string): Promise<QuestionMedia | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const resize = asset.width >= asset.height ? { width: Math.min(MAX_SIDE, asset.width) } : { height: Math.min(MAX_SIDE, asset.height) };
  const out = await manipulateAsync(asset.uri, [{ resize }], { compress: 0.8, format: SaveFormat.JPEG });
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
