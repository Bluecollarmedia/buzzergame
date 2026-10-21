import { beforeAll, describe, expect, it } from "vitest";
import { as, createQuiz, createUser, grantAccess, host, rpc, rpcError, su } from "./db";
import { mcQuiz } from "./fixtures";

let uid: string;
beforeAll(async () => {
  uid = await createUser();
  await grantAccess(uid);
});

const positions = async (quizId: string) =>
  (await as<{ id: string; position: number; prompt: string }>(host(uid), "select id, position, prompt from questions where quiz_id = $1 order by position", [quizId]));

describe("quiz editing", () => {
  it("adds, duplicates, deletes and reorders questions atomically", async () => {
    const [qz] = await as<{ id: string }>(host(uid), "insert into quizzes (owner_id, title, mode) values ($1, 'Draft', 'multiple_choice') returning id", [uid]);
    const addQ = async () => (await as<{ id: string }>(host(uid), "select * from public.add_question($1)", [qz!.id]))[0]!;
    const a = await addQ();
    await as(host(uid), "update questions set prompt = 'A' where id = $1", [a.id]);
    const b = await addQ();
    await as(host(uid), "update questions set prompt = 'B' where id = $1", [b.id]);
    const [dup] = await as<{ id: string }>(host(uid), "select * from public.duplicate_question($1)", [a.id]);
    expect((await positions(qz!.id)).map((q) => q.prompt)).toEqual(["A", "A", "B"]);
    await rpc(host(uid), "reorder_questions", { p_quiz_id: qz!.id, p_question_ids: [b.id, dup!.id, a.id] });
    expect((await positions(qz!.id)).map((q) => [q.prompt, q.position])).toEqual([["B", 0], ["A", 1], ["A", 2]]);
    await rpc(host(uid), "delete_question", { p_question_id: dup!.id });
    expect((await positions(qz!.id)).map((q) => q.position)).toEqual([0, 1]);
    expect(await rpcError(host(uid), "reorder_questions", { p_quiz_id: qz!.id, p_question_ids: [a.id] })).toBe("invalid_request");
  });

  it("only playable quizzes can be marked ready, and edits drop them back to draft", async () => {
    const [qz] = await as<{ id: string }>(host(uid), "insert into quizzes (owner_id, title, mode) values ($1, 'Draft', 'multiple_choice') returning id", [uid]);
    await as(host(uid), "select public.add_question($1)", [qz!.id]);
    await expect(as(host(uid), "update quizzes set status = 'ready' where id = $1", [qz!.id])).rejects.toThrow(/CQ:quiz_invalid/);
    expect(await rpc(host(uid), "quiz_issues", { p_quiz_id: qz!.id })).toEqual([
      "Question 1 needs a prompt", "Question 1 needs four answer choices", "Question 1 needs a correct answer",
    ]);
    await as(host(uid), "update questions set prompt = 'Q', choices = '{a,b,c,d}', correct_index = 1 where quiz_id = $1", [qz!.id]);
    await as(host(uid), "update quizzes set status = 'ready' where id = $1", [qz!.id]);
    await as(host(uid), "update questions set prompt = '' where quiz_id = $1", [qz!.id]);
    const [row] = await as<{ status: string }>(host(uid), "select status from quizzes where id = $1", [qz!.id]);
    expect(row!.status).toBe("draft");
    expect(await rpcError(host(uid), "create_session", { p_quiz_id: qz!.id })).toBe("quiz_invalid");
  });

  it("launching snapshots the questions so later edits never change a live game", async () => {
    const qz = await createQuiz(uid, mcQuiz(2));
    const s = await rpc(host(uid), "create_session", { p_quiz_id: qz });
    await as(host(uid), "update questions set prompt = 'Edited', correct_index = 3 where quiz_id = $1", [qz]);
    await as(host(uid), "delete from questions where quiz_id = $1 and position = 1", [qz]);
    const snap = await as<{ prompt: string; correct_index: number }>(su, "select prompt, correct_index from session_questions where session_id = $1 order by position", [s.sessionId]);
    expect(snap.map((q) => q.prompt)).toEqual(["Question 1?", "Question 2?"]);
    expect(snap[0]!.correct_index).toBe(0);
    // Deleting the quiz keeps the session and its results.
    await as(host(uid), "delete from quizzes where id = $1", [qz]);
    const [g] = await as<{ quiz_id: string | null; question_count: number }>(su, "select quiz_id, question_count from game_sessions where id = $1", [s.sessionId]);
    expect(g!.quiz_id).toBeNull();
    expect(g!.question_count).toBe(2);
  });

  it("duplicates a quiz with all its questions", async () => {
    const qz = await createQuiz(uid, mcQuiz(3));
    const copy = await rpc(host(uid), "duplicate_quiz", { p_quiz_id: qz });
    expect((await positions(copy)).map((q) => q.prompt)).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
    const [row] = await as<{ title: string; status: string }>(host(uid), "select title, status from quizzes where id = $1", [copy]);
    expect(row).toEqual({ title: "Copy of Test quiz", status: "draft" });
  });

  it("profiles are created automatically and only the display name is editable", async () => {
    const u = await createUser("named@test.local", "Named Host");
    const [p] = await as<{ display_name: string }>(host(u), "select display_name from profiles where id = $1", [u]);
    expect(p!.display_name).toBe("Named Host");
    await as(host(u), "update profiles set display_name = 'New' where id = $1", [u]);
    const [p2] = await as<{ display_name: string }>(host(u), "select display_name from profiles where id = $1", [u]);
    expect(p2!.display_name).toBe("New");
  });
});
