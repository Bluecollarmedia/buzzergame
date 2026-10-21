import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Creates a fresh throw-away database, applies a minimal Supabase stand-in
 * (auth.users, auth.uid(), roles) and then every migration in order.
 *
 * Uses CQ_TEST_ADMIN_URL (a Postgres superuser connection, default
 * postgres://postgres:postgres@localhost:5432/postgres). Never point this at
 * a production database: it drops and recreates CQ_TEST_DB_NAME.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

export default async function setup() {
  const adminUrl = process.env.CQ_TEST_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const dbName = process.env.CQ_TEST_DB_NAME ?? "crowdquiz_test";
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) throw new Error("Test database name must contain 'test'.");

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(readFileSync(join(here, "..", "sql", "supabase_stub.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  await db.end();
  process.env.CQ_TEST_DATABASE_URL = url.toString();
}
