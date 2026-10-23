import { AppState } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildQuestionImageUrl, createGameApi, type GameApi } from "@crowdquiz/shared";
import { authStorage } from "./authStorage";
import { config } from "./config";

// Players never need an account: they call the player functions with the
// public key. Hosts sign in, and their session is kept in the secure store.
let client: SupabaseClient | null = null;
let api: GameApi | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    // Refresh tokens only while the app is on screen.
    AppState.addEventListener("change", (s) => {
      if (s === "active") void client?.auth.startAutoRefresh();
      else void client?.auth.stopAutoRefresh();
    });
  }
  return client;
}

export function getApi(): GameApi {
  if (!api) api = createGameApi(getSupabase());
  return api;
}

/** Public address of a stored question photo. */
export function questionImageUrl(path: string | null | undefined): string | null {
  return buildQuestionImageUrl(config.supabaseUrl, path);
}
