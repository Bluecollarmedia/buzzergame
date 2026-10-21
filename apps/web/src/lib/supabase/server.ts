import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Server-side Supabase client bound to the request's auth cookies. */
export async function getServerSupabase() {
  const env = publicEnv();
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes cookies instead.
        }
      },
    },
  });
}

/** The signed-in user (validated with Supabase Auth), or null. */
export async function getUser() {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
