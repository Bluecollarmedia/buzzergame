import { NextResponse } from "next/server";

/**
 * Android app links. Set ANDROID_PACKAGE_NAME and ANDROID_SHA256_CERT_FINGERPRINTS
 * (comma-separated SHA-256 fingerprints of the app signing key).
 */
export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  const prints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!pkg || prints.length === 0) return NextResponse.json([]);
  return NextResponse.json([
    { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } },
  ]);
}
