import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createGameApi, type GameApi } from "@crowdquiz/shared";
import { config } from "./config";

// Players never sign in: the app only uses the public anon key and calls the
// player RPCs. No auth session is stored.
let client: SupabaseClient | null = null;
let api: GameApi | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

export function getApi(): GameApi {
  if (!api) api = createGameApi(getSupabase());
  return api;
}
