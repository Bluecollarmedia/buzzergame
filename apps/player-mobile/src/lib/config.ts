/** Public configuration baked into the app at build time. */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? "",
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/** Hosts whose https QR codes the scanner accepts. Empty = accept any host. */
export function allowedJoinHosts(): string[] {
  try {
    return config.siteUrl ? [new URL(config.siteUrl).host] : [];
  } catch {
    return [];
  }
}
