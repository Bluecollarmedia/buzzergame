/**
 * Public configuration. These values are safe to ship to browsers; no
 * secrets (such as the Supabase service-role key) are ever read here.
 */
export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
}

export function readPublicEnv(): { ok: true; env: PublicEnv } | { ok: false; missing: string[] } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length) return { ok: false, missing };
  return { ok: true, env: { supabaseUrl, supabaseAnonKey, siteUrl } };
}

export function publicEnv(): PublicEnv {
  const r = readPublicEnv();
  if (!r.ok) {
    throw new Error(`Missing configuration: ${r.missing.join(", ")}. Copy .env.example to .env.local and fill it in.`);
  }
  return r.env;
}

/** Base URL used in QR codes and emails. Falls back to the current origin. */
export function siteBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}
