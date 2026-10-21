"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + the signed-in host's session cookie). */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = publicEnv();
    client = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  }
  return client;
}
