// Captures real screenshots of the running app for review.
// Needs: local Supabase (pnpm db:start), seed data (pnpm seed:dev) and the
// website on http://localhost:3100. Usage: node e2e/capture-screens.mjs <outDir>
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const out = process.argv[2] ?? "screens";
mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3100";
const st = JSON.parse(execSync("supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
const db = new pg.Client({ connectionString: st.DB_URL });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const anon = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const proj = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };
let n = 0;
const shot = async (page, name) => {
  n += 1;
  await sleep(600);
  await page.screenshot({ path: `${out}/${String(n).padStart(2, "0")}-${name}.png` });
  console.log("shot", name);
};

async function signedIn(email, password) {
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  return { ctx, page };
}

// ---- Public pages
{
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await shot(page, "landing");
  await page.goto(`${BASE}/signup`);
  await shot(page, "signup");
  await ctx.close();
}

// ---- Host area
const host = await signedIn("host@crowdquiz.local", "host-password");
const hp = host.page;
await shot(hp, "host-dashboard");
await hp.goto(`${BASE}/quizzes`);
await hp.getByText("Sample: General Knowledge").first().waitFor();
await shot(hp, "quiz-library");
const mcQuiz = await q1("select q.id from quizzes q join auth.users u on u.id=q.owner_id where u.email='host@crowdquiz.local' and q.title='Sample: General Knowledge'");
const buzzQuiz = await q1("select q.id from quizzes q join auth.users u on u.id=q.owner_id where u.email='host@crowdquiz.local' and q.title='Sample: Buzzer Round'");
await hp.goto(`${BASE}/quizzes/${mcQuiz.id}`);
await hp.getByText("All changes saved").or(hp.getByLabel("Question", { exact: true })).first().waitFor();
await shot(hp, "quiz-editor");
await hp.getByRole("button", { name: "Launch" }).click();
await hp.getByRole("button", { name: "Open lobby" }).waitFor();
await shot(hp, "launch-settings");
await hp.getByRole("button", { name: "Cancel" }).click();
await hp.goto(`${BASE}/quizzes/new`);
await shot(hp, "new-quiz-mode-choice");

// Host API client for creating sessions with presentation-friendly timings.
const hostApi = anon();
await hostApi.auth.signInWithPassword({ email: "host@crowdquiz.local", password: "host-password" });
async function createSession(quizId, settings) {
  const { data, error } = await hostApi.rpc("create_session", { p_quiz_id: quizId, p_settings: settings });
  if (error) throw error;
  return data;
}

// ---- Multiple Choice game
const mc = await createSession(mcQuiz.id, { autoAdvance: false, timeLimitSeconds: 60, countdownSeconds: 1 });
await hp.goto(`${BASE}/sessions/${mc.sessionId}/host`);
const projCtx = await browser.newContext(proj);
const pj = await projCtx.newPage();
await pj.goto(`${BASE}/present/${mc.projectorToken}`);

// Phone players
const phones = [];
for (const name of ["Alice", "Bob"]) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  phones.push({ ctx, page, name });
}
const [alice, bob] = phones;
await alice.page.goto(`${BASE}/join`);
await alice.page.locator("#code").fill(mc.roomCode);
await shot(alice.page, "phone-join-by-room-code");
await alice.page.getByRole("button", { name: "Continue" }).click();
await alice.page.getByPlaceholder("Enter your name").fill("Alice");
await shot(alice.page, "phone-enter-name");
await alice.page.getByRole("button", { name: "Join game" }).click();
await alice.page.getByText("You're in!").waitFor();
await bob.page.goto(`${BASE}/j/${mc.joinToken}`);
await bob.page.getByPlaceholder("Enter your name").fill("Bob");
await bob.page.getByRole("button", { name: "Join game" }).click();
await bob.page.getByText("You're in!").waitFor();

// A few more players through the API so the room looks real.
const extras = [];
for (const name of ["Cara", "Dev", "Eli", "Fatima", "Gus", "Hana"]) {
  const secret = randomBytes(32).toString("base64url");
  const { data } = await anon().rpc("join_session", { p_join_token: mc.joinToken, p_display_name: name, p_player_secret: secret });
  extras.push({ name, secret, participantId: data.participantId });
}
await sleep(1500);
await shot(alice.page, "phone-lobby");
await shot(pj, "projector-lobby-qr");
await shot(hp, "host-lobby");

async function roundId(sessionId) {
  for (let i = 0; i < 40; i++) {
    const r = await q1("select current_round_id id, status from game_sessions where id=$1", [sessionId]);
    if (r.status === "question_open" && r.id) return r.id;
    await sleep(250);
  }
  throw new Error("question did not open");
}
const extraAnswers = async (sessionId, rid, choices) => {
  for (const [i, e] of extras.entries()) {
    if (choices[i] === null) continue;
    await anon().rpc("submit_answer", { p_session_id: sessionId, p_player_secret: e.secret, p_round_id: rid, p_choice_index: choices[i], p_submission_id: randomUUID() });
  }
};

await hp.getByRole("button", { name: "Start game" }).click();
let rid = await roundId(mc.sessionId);
await sleep(800);
await shot(pj, "projector-mc-question");
await shot(alice.page, "phone-mc-answer-buttons");
await alice.page.getByRole("group", { name: "Answers" }).getByRole("button").nth(1).click();
await alice.page.getByText("locked in").waitFor();
await shot(alice.page, "phone-mc-locked-in");
await bob.page.getByRole("group", { name: "Answers" }).getByRole("button").nth(2).click();
await extraAnswers(mc.sessionId, rid, [1, 1, 0, 1, 3, null]);
await sleep(1200);
await shot(hp, "host-mc-question-live");
await shot(pj, "projector-mc-answers-coming-in");
await hp.getByRole("button", { name: "End question now" }).click();
await sleep(1500);
await shot(pj, "projector-mc-reveal");
await shot(alice.page, "phone-mc-correct");
await shot(bob.page, "phone-mc-wrong");
await shot(hp, "host-mc-reveal");
await hp.getByRole("button", { name: "Next" }).click();
await sleep(1500);
await shot(pj, "projector-leaderboard");
await shot(alice.page, "phone-leaderboard");

// Play the remaining questions quickly.
const total = (await q1("select count(*)::int n from session_questions where session_id=$1", [mc.sessionId])).n;
for (let qn = 2; qn <= total; qn++) {
  await hp.getByRole("button", { name: "Next" }).click();
  rid = await roundId(mc.sessionId);
  const correct = (await q1("select sq.correct_index c from session_rounds r join session_questions sq on sq.id=r.question_id where r.id=$1", [rid])).c;
  await alice.page.getByRole("group", { name: "Answers" }).getByRole("button").nth(correct).click();
  await bob.page.getByRole("group", { name: "Answers" }).getByRole("button").nth(qn % 2 ? correct : (correct + 1) % 4).click();
  await extraAnswers(mc.sessionId, rid, [correct, (correct + 1) % 4, correct, null, correct, (correct + 2) % 4]);
  await sleep(500);
  await hp.getByRole("button", { name: "End question now" }).click();
  await sleep(800);
  const last = qn === total;
  await hp.getByRole("button", { name: last ? "Show final results" : "Next" }).click();
  await sleep(800);
}
await sleep(1500);
await shot(pj, "projector-final-results");
await shot(alice.page, "phone-final-winner");
await shot(bob.page, "phone-final-placed");
await hp.goto(`${BASE}/sessions/${mc.sessionId}/results`);
await sleep(1000);
await shot(hp, "host-results-page");
await projCtx.close();

// ---- Color Buzzer game
const bz = await createSession(buzzQuiz.id, { countdownSeconds: 1 });
await hp.goto(`${BASE}/sessions/${bz.sessionId}/host`);
const pj2Ctx = await browser.newContext(proj);
const pj2 = await pj2Ctx.newPage();
await pj2.goto(`${BASE}/present/${bz.projectorToken}`);
const bphones = [];
for (const name of ["Alice", "Bob", "Cara"]) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/j/${bz.joinToken}`);
  await page.getByPlaceholder("Enter your name").fill(name);
  await page.getByRole("button", { name: "Join game" }).click();
  await page.getByText("You're in!").waitFor();
  bphones.push({ ctx, page, name });
}
await sleep(1000);
await hp.getByRole("button", { name: "Start game" }).click();
rid = await roundId(bz.sessionId);
await sleep(1000);
await shot(pj2, "projector-buzzer-question");
await shot(bphones[0].page, "phone-buzzer-buttons");
const correct = (await q1("select sq.correct_index c from session_rounds r join session_questions sq on sq.id=r.question_id where r.id=$1", [rid])).c;
await bphones[2].page.getByRole("group", { name: "Answers" }).getByRole("button").nth((correct + 1) % 4).click();
await bphones[2].page.getByText("You're out").waitFor();
await shot(bphones[2].page, "phone-buzzer-locked-out");
await shot(hp, "host-buzzer-live");
await bphones[1].page.getByRole("group", { name: "Answers" }).getByRole("button").nth(correct).click();
await sleep(1500);
await shot(bphones[1].page, "phone-buzzer-won");
await shot(bphones[0].page, "phone-buzzer-someone-else-won");
await shot(pj2, "projector-buzzer-winner");
await shot(hp, "host-buzzer-winner");

// ---- Admin and account
const adm = await signedIn("admin@crowdquiz.local", "admin-password");
await adm.page.goto(`${BASE}/admin`);
await sleep(800);
await shot(adm.page, "admin-overview");
await adm.page.getByRole("tab", { name: "Access codes" }).click();
await adm.page.getByRole("button", { name: "New access code" }).click();
await shot(adm.page, "admin-new-access-code");
await adm.page.locator("#note").fill("Demo for screenshots");
await adm.page.getByRole("button", { name: "Create code" }).click();
await sleep(1000);
await shot(adm.page, "admin-code-created");
await adm.page.getByRole("tab", { name: "Hosts" }).click();
await sleep(800);
await shot(adm.page, "admin-hosts");
await hp.goto(`${BASE}/account/redeem`);
await shot(hp, "host-redeem-code");

await browser.close();
await db.end();
console.log("done", n);
