#!/usr/bin/env node
/**
 * Development seed. LOCAL USE ONLY: it refuses to run against anything but
 * a local Supabase stack. Creates an admin, a host with access, and two
 * sample quizzes (one per game mode).
 *
 *   pnpm db:start && pnpm seed:dev
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const status = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "inherit"] }).toString());
const url = new URL(status.API_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing to seed a non-local database.");
  process.exit(1);
}

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new Client({ connectionString: status.DB_URL });
await db.connect();

async function user(email, password, displayName) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
  if (error) throw error;
  return data.user.id;
}

const adminId = await user("admin@crowdquiz.local", "admin-password", "Admin");
await db.query("insert into public.admin_users (user_id) values ($1) on conflict do nothing", [adminId]);
const hostId = await user("host@crowdquiz.local", "host-password", "Demo Host");
await db.query(
  `insert into public.entitlements (user_id, plan, starts_at, expires_at, source)
   select $1, 'standard', now(), now() + interval '365 days', 'admin'
   where not exists (select 1 from public.entitlements where user_id = $1 and status = 'active' and expires_at > now())`,
  [hostId],
);

const quizzes = [
  {
    title: "Sample: General Knowledge",
    mode: "multiple_choice",
    questions: [
      ["What is the capital of France?", ["Berlin", "Paris", "Madrid", "Rome"], 1],
      ["How many legs does a spider have?", ["6", "8", "10", "12"], 1],
      ["Which planet is closest to the Sun?", ["Mercury", "Venus", "Earth", "Mars"], 0],
      ["What is H2O?", ["Salt", "Oxygen", "Water", "Hydrogen"], 2],
    ],
  },
  {
    title: "Sample: Buzzer Round",
    mode: "color_buzzer",
    questions: [
      ["Which ocean is the largest?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
      ["Who painted the Mona Lisa?", ["Van Gogh", "Da Vinci", "Picasso", "Monet"], 1],
      ["What is 9 × 7?", ["63", "56", "72", "49"], 0],
    ],
  },
];
for (const q of quizzes) {
  const { rows } = await db.query("select id from public.quizzes where owner_id = $1 and title = $2", [hostId, q.title]);
  if (rows.length) continue;
  const {
    rows: [quiz],
  } = await db.query("insert into public.quizzes (owner_id, title, mode) values ($1, $2, $3) returning id", [hostId, q.title, q.mode]);
  for (const [i, [prompt, choices, correct]] of q.questions.entries()) {
    await db.query("insert into public.questions (quiz_id, position, prompt, choices, correct_index) values ($1, $2, $3, $4, $5)", [
      quiz.id,
      i,
      prompt,
      choices,
      correct,
    ]);
  }
  await db.query("update public.quizzes set status = 'ready' where id = $1", [quiz.id]);
}
await db.end();
console.log("Seeded. Sign in at http://localhost:3100/login");
console.log("  admin@crowdquiz.local / admin-password  (admin)");
console.log("  host@crowdquiz.local  / host-password   (host with access)");
