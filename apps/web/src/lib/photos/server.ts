import { AwsClient } from "aws4fetch";
import { readPublicEnv } from "@/lib/env";

/**
 * Question photos live in a Cloudflare R2 bucket. Only the website talks to
 * R2, with these server-only settings (never sent to browsers or the app):
 *
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   PHOTO_PUBLIC_URL  the bucket's public address, e.g. https://pub-xxxx.r2.dev
 *   R2_ENDPOINT       optional, for local testing against another S3-style server
 */
interface R2Config {
  endpoint: string;
  publicUrl: string;
  client: AwsClient;
}

let cached: R2Config | null | undefined;

export function r2(): R2Config | null {
  if (cached !== undefined) return cached;
  const accountId = process.env.R2_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket = process.env.R2_BUCKET ?? "";
  const publicUrl = (process.env.PHOTO_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    cached = null;
    return null;
  }
  cached = {
    endpoint: process.env.R2_ENDPOINT
      ? `${process.env.R2_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`
      : `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}`,
    publicUrl,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  };
  return cached;
}

const objectUrl = (c: R2Config, path: string) => `${c.endpoint}/${path}`;

export async function r2Exists(c: R2Config, path: string): Promise<boolean> {
  const res = await c.client.fetch(objectUrl(c, path), {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  return true;
}

export async function r2Put(
  c: R2Config,
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const res = await c.client.fetch(objectUrl(c, path), {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
}

export async function r2Delete(c: R2Config, path: string): Promise<void> {
  const res = await c.client.fetch(objectUrl(c, path), {
    method: "DELETE",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
}

/** Where photos uploaded before the move to R2 still sit (a public bucket). */
export function supabasePhotoUrl(path: string): string | null {
  const env = readPublicEnv();
  if (!env.ok) return null;
  return `${env.env.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/question-images/${path}`;
}

/** The caller's Supabase access token from "Authorization: Bearer ...". */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : null;
}

export class RpcError extends Error {}

/**
 * Calls a database function as the signed-in host, so the database's own
 * checks (who they are, limits, the Photo uploads switch, admin) apply.
 */
export async function rpcAsUser<T>(
  token: string,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const env = readPublicEnv();
  if (!env.ok) throw new RpcError("CQ:internal");
  const res = await fetch(`${env.env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.env.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const msg = body?.message ?? "";
    if (/^CQ:[a-z_]+$/.test(msg)) throw new RpcError(msg);
    if (res.status === 401 || /JWT/i.test(msg)) throw new RpcError("CQ:not_authenticated");
    throw new RpcError("CQ:internal");
  }
  return (await res.json()) as T;
}

/** Recognises JPEG, PNG and WebP from the first bytes of the file. */
export function sniffImage(
  bytes: Uint8Array,
): { ext: "jpg" | "png" | "webp"; type: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { ext: "jpg", type: "image/jpeg" };
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: "png", type: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return { ext: "webp", type: "image/webp" };
  }
  return null;
}

/** JSON error in the same "CQ:<code>" form the database uses. */
export function errorResponse(code: string, status: number) {
  return Response.json(
    { error: code.startsWith("CQ:") ? code : `CQ:${code}` },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function statusFor(code: string): number {
  switch (code) {
    case "CQ:not_authenticated":
      return 401;
    case "CQ:forbidden":
    case "CQ:account_disabled":
      return 403;
    case "CQ:photo_limit":
    case "CQ:photo_uploads_off":
      return 409;
    case "CQ:rate_limited":
      return 429;
    case "CQ:invalid_request":
      return 400;
    default:
      return 500;
  }
}
