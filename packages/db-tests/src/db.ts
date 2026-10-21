import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.CQ_TEST_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbName = process.env.CQ_TEST_DB_NAME ?? "crowdquiz_test";
const url = new URL(adminUrl);
url.pathname = `/${dbName}`;

export const pool = new pg.Pool({ connectionString: url.toString(), max: 40 });

type Role = { kind: "anon"; ip?: string } | { kind: "host"; uid: string } | { kind: "superuser" };

/** Each anonymous call looks like a different device unless an IP is given. */
const randomIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

/** Run one statement the way PostgREST would: its own transaction and role. */
export async function as<T = Record<string, unknown>>(role: Role, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (role.kind === "anon") {
      await c.query("set local role anon");
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-forwarded-for": role.ip ?? randomIp() })]);
    } else if (role.kind === "host") {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: role.uid, role: "authenticated" })]);
    }
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows as T[];
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const anon: Role = { kind: "anon" };
export const anonFrom = (ip: string): Role => ({ kind: "anon", ip });
export const su: Role = { kind: "superuser" };
export const host = (uid: string): Role => ({ kind: "host", uid });

/** Call an RPC and return its JSON result. */
export async function rpc<T = any>(role: Role, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  const rows = await as<{ r: T }>(role, sql, names.map((n) => args[n]));
  const r = rows[0]!.r as unknown as { error?: unknown };
  // Soft errors ({"error": code}) are treated exactly like raised errors.
  if (r && typeof r === "object" && typeof r.error === "string") throw new Error(`CQ:${r.error}`);
  return rows[0]!.r;
}

/** Expect an RPC to fail with CQ:<code>. */
export async function rpcError(role: Role, fn: string, args: Record<string, unknown> = {}): Promise<string> {
  try {
    await rpc(role, fn, args);
  } catch (e) {
    const m = /CQ:([a-z_]+)/.exec((e as Error).message);
    return m ? m[1]! : (e as Error).message;
  }
  throw new Error(`${fn} unexpectedly succeeded`);
}

export async function createUser(email = `host-${randomUUID()}@test.local`, name = "Test Host"): Promise<string> {
  const rows = await as<{ id: string }>(su, "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
    email,
    { display_name: name },
  ]);
  return rows[0]!.id;
}

export async function grantAccess(uid: string, hours = 24) {
  await as(su, "insert into public.entitlements (user_id, expires_at, source) values ($1, now() + make_interval(hours => $2), 'admin')", [uid, hours]);
}

export async function makeAdmin(uid: string) {
  await as(su, "insert into public.admin_users (user_id) values ($1) on conflict do nothing", [uid]);
}

export interface QuizSpec {
  mode: "multiple_choice" | "color_buzzer";
  questions: Array<{ prompt: string; choices: [string, string, string, string]; correct: number }>;
  settings?: Record<string, unknown>;
}

export async function createQuiz(uid: string, spec: QuizSpec): Promise<string> {
  const [qz] = await as<{ id: string }>(host(uid),
    "insert into public.quizzes (owner_id, title, mode, settings) values ($1, $2, $3, $4) returning id",
    [uid, "Test quiz", spec.mode, spec.settings ?? {}]);
  for (const [i, q] of spec.questions.entries()) {
    await as(host(uid), "insert into public.questions (quiz_id, position, prompt, choices, correct_index) values ($1,$2,$3,$4,$5)",
      [qz!.id, i, q.prompt, q.choices, q.correct]);
  }
  return qz!.id;
}

export const secret = () => randomBytes(32).toString("base64url");

export interface Player { participantId: string; secret: string; name: string }

export async function joinPlayers(joinToken: string, names: string[]): Promise<Player[]> {
  const out: Player[] = [];
  for (const name of names) {
    const s = secret();
    const r = await rpc(anon, "join_session", { p_join_token: joinToken, p_display_name: name, p_player_secret: s });
    out.push({ participantId: r.participantId, secret: s, name });
  }
  return out;
}

/** Test-only: make the current phase's deadline pass immediately. */
export async function expirePhase(sessionId: string) {
  await as(su, `update public.game_sessions set
      phase_ends_at = case when phase_ends_at is not null then clock_timestamp() - interval '1 second' end,
      question_deadline = case when question_deadline is not null then clock_timestamp() - interval '1 second' end
    where id = $1`, [sessionId]);
  await as(su, `update public.session_rounds set deadline = clock_timestamp() - interval '1 second'
    where session_id = $1 and status = 'open' and deadline is not null`, [sessionId]);
}

export async function tick(sessionId: string) {
  return rpc(anon, "tick_session", { p_session_id: sessionId });
}

export async function status(sessionId: string): Promise<string> {
  const [r] = await as<{ status: string }>(su, "select status from public.game_sessions where id = $1", [sessionId]);
  return r!.status;
}

export async function playerState(sessionId: string, p: Player) {
  return rpc(anon, "player_state", { p_session_id: sessionId, p_player_secret: p.secret });
}

export async function submit(sessionId: string, p: Player, roundId: string, choice: number, submissionId = randomUUID()) {
  return rpc(anon, "submit_answer", {
    p_session_id: sessionId, p_player_secret: p.secret, p_round_id: roundId, p_choice_index: choice, p_submission_id: submissionId,
  });
}

/** Move a fresh session from lobby to its first open question. */
export async function startToFirstQuestion(uid: string, sessionId: string): Promise<string> {
  const st = await rpc(host(uid), "host_state", { p_session_id: sessionId });
  await rpc(host(uid), "host_command", { p_session_id: sessionId, p_command: "start", p_expected_version: st.session.stateVersion });
  return openCurrent(sessionId);
}

/** If counting down, skip the countdown and return the open round id. */
export async function openCurrent(sessionId: string): Promise<string> {
  if ((await status(sessionId)) === "countdown") {
    await expirePhase(sessionId);
    await tick(sessionId);
  }
  const [r] = await as<{ current_round_id: string; status: string }>(su,
    "select current_round_id, status from public.game_sessions where id = $1", [sessionId]);
  if (r!.status !== "question_open") throw new Error(`expected question_open, got ${r!.status}`);
  return r!.current_round_id;
}
