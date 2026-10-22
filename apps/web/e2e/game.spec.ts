import { test, expect, type Page } from "@playwright/test";
import { answerButton, anonClient, createAdmin, joinByLink, newPlayerPage, signIn, sql, stack, uniq } from "./helpers";
import { createClient } from "@supabase/supabase-js";

/**
 * Full browser walk-through against a local Supabase stack:
 * admin issues an access code, a host signs up, redeems it, builds a quiz,
 * runs a Multiple Choice game for three phone-sized players with a projector
 * open, then runs a Color Buzzer game with a simultaneous buzz.
 */

test.describe.configure({ mode: "serial" });

const host = { name: "Quiz Host", email: `host-${uniq()}@example.test`, password: "host-password-123" };
let mcSessionId = "";

async function setNumber(page: Page, id: string, value: number) {
  const input = page.locator(`#${id}`);
  await input.fill(String(value));
  await input.blur();
}

async function sessionTokens(sessionId: string) {
  const [row] = await sql<{ join_token: string; projector_token: string; room_code: string }>(
    "select join_token, projector_token, room_code from public.game_sessions where id = $1",
    [sessionId],
  );
  return row!;
}

test("admin issues a code, host signs up and redeems it", async ({ browser }) => {
  const admin = await createAdmin();
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signIn(adminPage, admin.email, admin.password);
  await adminPage.goto("/admin");
  await adminPage.getByRole("tab", { name: "Access codes" }).click();
  await adminPage.getByRole("button", { name: "New access code" }).click();
  await adminPage.locator("#note").fill("E2E code");
  await adminPage.getByRole("button", { name: "Create code" }).click();
  const code = (await adminPage.locator("code").first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await adminCtx.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(host.name);
  await page.getByLabel("Email").fill(host.email);
  await page.getByLabel("Password").fill(host.password);
  await page.getByRole("button", { name: /create/i }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/account/redeem");
  await page.getByLabel("Access code").fill(code.toLowerCase().replace(/-/g, ""));
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText("Code redeemed")).toBeVisible();
  await ctx.storageState({ path: "e2e/.auth-host.json" });
  await ctx.close();
});

test("multiple choice game with three players and a projector", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth-host.json" });
  const hostPage = await ctx.newPage();

  // Build a two-question quiz in the editor.
  await hostPage.goto("/quizzes/new");
  await hostPage.getByText("Multiple Choice", { exact: true }).click();
  await hostPage.getByLabel("Quiz title").fill("E2E Trivia");
  await hostPage.getByRole("button", { name: "Create and add questions" }).click();
  await hostPage.waitForURL(/\/quizzes\/[0-9a-f-]{36}$/);
  const quizId = hostPage.url().split("/").pop()!;

  const fillQuestion = async (prompt: string, choices: string[], correct: number) => {
    await hostPage.getByLabel("Question", { exact: true }).fill(prompt);
    for (let i = 0; i < 4; i++) await hostPage.locator(`#choice-${i}`).fill(choices[i]!);
    await hostPage.getByLabel("Correct").nth(correct).check();
  };
  await fillQuestion("What is 2 + 2?", ["3", "4", "5", "22"], 1);
  await hostPage.getByRole("button", { name: "Add question" }).first().click();
  await expect(hostPage.getByRole("list", { name: "Questions" }).getByRole("listitem")).toHaveCount(2);
  await fillQuestion("Which colour is the sky?", ["Blue", "Green", "Red", "Purple"], 0);
  await expect(hostPage.getByText("All changes saved")).toBeVisible();

  // The draft survives a reload.
  await hostPage.reload();
  await expect(hostPage.getByRole("list", { name: "Questions" }).getByRole("listitem")).toHaveCount(2);
  const saved = await sql<{ n: number }>("select count(*)::int n from public.questions where quiz_id = $1 and correct_index is not null", [quizId]);
  expect(saved[0]!.n).toBe(2);

  // Launch with short timings.
  await hostPage.getByRole("button", { name: "Launch" }).click();
  await setNumber(hostPage, "f-question-timer", 6);
  await hostPage.getByText("Timing and limits").click();
  await setNumber(hostPage, "f-get-ready-countdown", 1);
  await setNumber(hostPage, "f-answer-reveal", 2);
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await hostPage.waitForURL(/\/sessions\/[0-9a-f-]{36}\/host$/);
  mcSessionId = hostPage.url().split("/").at(-2)!;
  const tokens = await sessionTokens(mcSessionId);
  await expect(hostPage.getByTestId("room-code")).toContainText(tokens.room_code.slice(0, 3));

  // Projector.
  const projCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const projector = await projCtx.newPage();
  await projector.goto(`/present/${tokens.projector_token}`);
  await expect(projector.getByText(tokens.room_code.slice(0, 3))).toBeVisible();
  const projectorErrors: string[] = [];
  projector.on("pageerror", (e) => projectorErrors.push(e.message));

  // Music: the projector asks for one click, then plays; the host can mute it remotely.
  await projector.getByRole("button", { name: "Click to turn on music" }).click();
  await expect(projector.getByTestId("projector-sound")).toHaveAttribute("aria-pressed", "true");
  await hostPage.getByRole("button", { name: "Projector music on" }).click();
  await expect(projector.getByTestId("projector-sound")).toHaveCount(0);
  await hostPage.getByRole("button", { name: "Projector music off" }).click();
  await expect(projector.getByTestId("projector-sound")).toHaveAttribute("aria-pressed", "true");

  // Players: one by room code, two by QR link.
  const a = await newPlayerPage(browser);
  await a.page.goto("/join");
  await a.page.locator("#code").fill(tokens.room_code);
  await a.page.getByRole("button", { name: "Continue" }).click();
  await a.page.getByPlaceholder("Enter your name").fill("Alice");
  await a.page.getByRole("button", { name: "Join game" }).click();
  await expect(a.page.getByText("You're in!")).toBeVisible();
  const b = await newPlayerPage(browser);
  await joinByLink(b.page, `/j/${tokens.join_token}`, "Bob");
  const c = await newPlayerPage(browser);
  await joinByLink(c.page, `/j/${tokens.join_token}`, "Cara");
  await expect(hostPage.getByText("3 players")).toBeVisible();
  await expect(projector.getByText("Cara")).toBeVisible();

  // Q1: Alice right, Bob wrong, Cara silent.
  await hostPage.getByRole("button", { name: "Start game" }).click();
  await expect(projector.getByText("What is 2 + 2?")).toBeVisible();
  await expect(a.page.getByText("What is 2 + 2?")).toHaveCount(0); // the phone never shows the question
  await answerButton(a.page, "B").click();
  await expect(a.page.getByText("Answer B locked in")).toBeVisible();
  await answerButton(b.page, "C").click();
  await expect(b.page.getByText("Answer C locked in")).toBeVisible();

  await expect(a.page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
  await expect(b.page.getByText("Not this time")).toBeVisible();
  await expect(c.page.getByText("No answer")).toBeVisible();

  // A late answer sent straight to the API is refused.
  const [round] = await sql<{ id: string }>(
    "select id from public.session_rounds where session_id = $1 order by opened_at limit 1",
    [mcSessionId],
  );
  const cSecret = await c.page.evaluate((t) => JSON.parse(localStorage.getItem(`cq:player:${t}`)!).secret as string, tokens.join_token);
  const late = await anonClient().rpc("submit_answer", {
    p_session_id: mcSessionId,
    p_player_secret: cSecret,
    p_round_id: round!.id,
    p_choice_index: 1,
    p_submission_id: crypto.randomUUID(),
  });
  expect(late.data?.error ?? late.error?.message).toMatch(/question_closed|too_late/);

  // Q2 follows automatically. Bob reloads mid-question and is still Bob.
  await expect(projector.getByText("Which colour is the sky?")).toBeVisible({ timeout: 20_000 });
  await b.page.reload();
  await expect(answerButton(b.page, "A")).toBeEnabled();
  await answerButton(b.page, "A").click();
  await expect(b.page.getByText("Answer A locked in")).toBeVisible();
  await answerButton(a.page, "A").click();
  await answerButton(c.page, "D").click();

  // Final results.
  await expect(a.page.getByText("You won!")).toBeVisible({ timeout: 25_000 });
  await expect(b.page.getByText("You finished #2")).toBeVisible();
  await expect(projector.getByText("Final results")).toBeVisible();

  const ledger = await sql<{ display_name: string; points: number }>(
    `select p.display_name, coalesce(sum(e.points), 0)::int points
       from public.participants p
       left join public.score_events e on e.participant_id = p.id
      where p.session_id = $1 group by p.display_name order by p.display_name`,
    [mcSessionId],
  );
  expect(ledger).toEqual([
    { display_name: "Alice", points: 2 },
    { display_name: "Bob", points: 1 },
    { display_name: "Cara", points: 0 },
  ]);
  const players = await sql<{ n: number }>("select count(*)::int n from public.participants where session_id = $1", [mcSessionId]);
  expect(players[0]!.n).toBe(3); // the reload did not create a second Bob
  const answers = await sql<{ n: number }>(
    "select count(*)::int n from public.answers a join public.participants p on p.id = a.participant_id where p.session_id = $1 and p.display_name = 'Bob'",
    [mcSessionId],
  );
  expect(answers[0]!.n).toBe(2);

  await hostPage.goto(`/sessions/${mcSessionId}/results`);
  await expect(hostPage.getByRole("cell", { name: "Alice" })).toBeVisible();

  expect(projectorErrors).toEqual([]);
  await Promise.all([a.ctx.close(), b.ctx.close(), c.ctx.close(), projCtx.close(), ctx.close()]);
});

test("color buzzer: wrong press locks out, simultaneous correct presses give one winner", async ({ browser }) => {
  // Create the quiz through the API as the host (the editor is covered above).
  const sb = createClient(stack().API_URL, stack().ANON_KEY, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email: host.email, password: host.password });
  expect(authError).toBeNull();
  const { data: quiz, error } = await sb
    .from("quizzes")
    .insert({ owner_id: auth.user!.id, title: "E2E Buzzer", mode: "color_buzzer" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const q = await sb.rpc("add_question", { p_quiz_id: quiz!.id, p_after_position: null });
  await sb.from("questions").update({ prompt: "Which planet is red?", choices: ["Venus", "Mars", "Earth", "Jupiter"], correct_index: 1 }).eq("id", q.data.id);

  const ctx = await browser.newContext({ storageState: "e2e/.auth-host.json" });
  const hostPage = await ctx.newPage();
  await hostPage.goto(`/quizzes/${quiz!.id}`);
  await hostPage.getByRole("button", { name: "Launch" }).click();
  await hostPage.getByText("Timing and limits").click();
  await setNumber(hostPage, "f-get-ready-countdown", 1);
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await hostPage.waitForURL(/\/sessions\/[0-9a-f-]{36}\/host$/);
  const sessionId = hostPage.url().split("/").at(-2)!;
  const tokens = await sessionTokens(sessionId);

  const players = await Promise.all(["Dan", "Eve", "Finn"].map(async () => newPlayerPage(browser)));
  await joinByLink(players[0]!.page, `/j/${tokens.join_token}`, "Dan");
  await joinByLink(players[1]!.page, `/j/${tokens.join_token}`, "Eve");
  await joinByLink(players[2]!.page, `/j/${tokens.join_token}`, "Finn");
  const [dan, eve, finn] = players.map((p) => p.page) as [Page, Page, Page];

  await hostPage.getByRole("button", { name: "Start game" }).click();
  await expect(answerButton(finn, "A")).toBeEnabled({ timeout: 15_000 });

  // Finn presses the wrong colour and is locked out.
  await answerButton(finn, "A").click();
  await expect(finn.getByText("Not quite. You're out for this question.")).toBeVisible();
  await expect(answerButton(finn, "B")).toBeDisabled();

  // Dan and Eve press the right colour at the same moment.
  await expect(answerButton(dan, "B")).toBeEnabled();
  await expect(answerButton(eve, "B")).toBeEnabled();
  await Promise.all([answerButton(dan, "B").click(), answerButton(eve, "B").click()]);

  const winners = await sql<{ n: number }>(
    "select count(*)::int n from public.score_events e join public.session_rounds r on r.id = e.round_id where r.session_id = $1",
    [sessionId],
  );
  expect(winners[0]!.n).toBe(1);
  const [{ name: winnerName }] = await sql<{ name: string }>(
    "select p.display_name name from public.session_rounds r join public.participants p on p.id = r.winner_participant_id where r.session_id = $1",
    [sessionId],
  );
  const winnerPage = winnerName === "Dan" ? dan : eve;
  const loserPage = winnerName === "Dan" ? eve : dan;
  await expect(winnerPage.getByText("You got it first!")).toBeVisible();
  await expect(loserPage.getByText(`${winnerName} got it first`)).toBeVisible();
  await expect(finn.getByText(`${winnerName} got it first`)).toBeVisible();

  // Single question, so the host shows the final results.
  await hostPage.getByRole("button", { name: "Show final results" }).click();
  await expect(winnerPage.getByText("You won!")).toBeVisible();

  await Promise.all([...players.map((p) => p.ctx.close()), ctx.close()]);
});
