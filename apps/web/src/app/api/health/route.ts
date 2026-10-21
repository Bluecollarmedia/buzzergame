import { NextResponse } from "next/server";
import { readPublicEnv } from "@/lib/env";

/**
 * Deployment diagnostics: configuration present and database reachable.
 * Returns no secrets.
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const env = readPublicEnv();
  if (!env.ok) {
    return NextResponse.json({ ok: false, requestId, problem: "missing_configuration", missing: env.missing }, { status: 503 });
  }
  const started = Date.now();
  try {
    const res = await fetch(`${env.env.supabaseUrl}/rest/v1/rpc/server_time`, {
      method: "POST",
      headers: { apikey: env.env.supabaseAnonKey, Authorization: `Bearer ${env.env.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.ok;
    const body = ok ? await res.json() : null;
    const result = { ok, requestId, database: ok ? "reachable" : `error ${res.status}`, serverTime: body, latencyMs: Date.now() - started };
    if (!ok) console.error(JSON.stringify({ level: "error", event: "health.database_error", requestId, status: res.status }));
    return NextResponse.json(result, { status: ok ? 200 : 503 });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "health.database_unreachable", requestId, message: (e as Error).message }));
    return NextResponse.json({ ok: false, requestId, database: "unreachable" }, { status: 503 });
  }
}
