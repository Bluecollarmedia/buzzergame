// Deletes the photo files that the nightly clean-up has queued.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-photos.mjs
//
// The service-role key is secret: run this on your own computer or a private
// scheduler, never inside the app or the website.
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(path, init) {
  const res = await fetch(`${url}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

let total = 0;
for (;;) {
  const paths = await call("/rest/v1/rpc/photo_trash_batch", { method: "POST", body: JSON.stringify({ p_limit: 200 }) });
  if (!paths?.length) break;
  await call("/storage/v1/object/question-images", { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
  await call("/rest/v1/rpc/photo_trash_done", { method: "POST", body: JSON.stringify({ p_paths: paths }) });
  total += paths.length;
}
console.log(`Deleted ${total} photo file(s).`);
