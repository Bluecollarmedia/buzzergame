import { execSync } from "node:child_process";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Helpers for the end-to-end tests. They talk to the local Supabase stack
 * started with `supabase start`. The service-role key is read from the local
 * CLI only and is never used by the app itself.
 */

interface LocalStack {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL: string;
}

let cached: LocalStack | null = null;
export function stack(): LocalStack {
  if (cached) return cached;
  if (process.env.E2E_SUPABASE_URL) {
    cached = {
      API_URL: process.env.E2E_SUPABASE_URL,
      ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "",
      SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
      DB_URL: process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    };
  } else {
    const out = execSync("supabase status -o json", { cwd: `${__dirname}/../../..`, stdio: ["ignore", "pipe", "ignore"] });
    cached = JSON.parse(out.toString()) as LocalStack;
  }
  return cached;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: stack().DB_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export function anonClient(): SupabaseClient {
  return createClient(stack().API_URL, stack().ANON_KEY, { auth: { persistSession: false } });
}

export const uniq = () => Math.random().toString(36).slice(2, 8);

/** Create a confirmed admin account directly (mirrors docs/admin-bootstrap.md). */
export async function createAdmin(): Promise<{ email: string; password: string }> {
  const admin = createClient(stack().API_URL, stack().SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = `admin-${uniq()}@example.test`;
  const password = "admin-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Admin" } });
  if (error) throw error;
  await sql("insert into public.admin_users (user_id) values ($1)", [data.user.id]);
  return { email, password };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

export async function newPlayerPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return { ctx, page: await ctx.newPage() };
}

export async function joinByLink(page: Page, joinUrl: string, name: string) {
  await page.goto(joinUrl);
  await page.getByPlaceholder("Enter your name").fill(name);
  await page.getByRole("button", { name: "Join game" }).click();
  await expect(page.getByText("You're in!")).toBeVisible();
}

export function answerButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByRole("group", { name: "Answers" }).getByRole("button", { name: new RegExp(`^\\w+ ${letter}\\b`) });
}
