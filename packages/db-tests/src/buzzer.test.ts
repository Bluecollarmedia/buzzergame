import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anon, as, createQuiz, createUser, grantAccess, host, joinPlayers, openCurrent, playerState,
  rpc, rpcError, startToFirstQuestion, status, submit, su,
} from "./db";
import { buzzerQuiz } from "./fixtures";

let uid: string;
beforeAll(async () => {
  uid = await createUser();
  await grantAccess(uid);
});

async function launch(n = 2, settings: Record<string, unknown> = {}) {
  const quizId = await createQuiz(uid, buzzerQuiz(n, settings));
  return rpc(host(uid), "create_session", { p_quiz_id: quizId });
}

describe("color buzzer", () => {
  it("has no countdown by default and locks out a wrong answer without ending the question", async () => {
    const s = await launch();
    const [ann, bob, cat] = await joinPlayers(s.joinToken, ["Ann", "Bob", "Cat"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    const ps = await playerState(s.sessionId, ann!);
    expect(ps.question.deadline).toBeNull();
    expect(ps.question.choices).toBeNull(); // phone shows colours only by default

    // Correct answer for question 1 is index 2 (Green).
    const wrong = await submit(s.sessionId, ann!, r1, 0);
    expect(wrong.result).toBe("wrong");
    expect(await status(s.sessionId)).toBe("question_open");
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: ann!.secret, p_round_id: r1, p_choice_index: 2, p_submission_id: randomUUID(),
    })).toBe("locked_out");

    const win = await submit(s.sessionId, bob!, r1, 2);
    expect(win.result).toBe("won");
    expect(await status(s.sessionId)).toBe("reveal");
    // After a winner the question is closed to everyone.
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: cat!.secret, p_round_id: r1, p_choice_index: 2, p_submission_id: randomUUID(),
    })).toBe("question_closed");

    const proj = await rpc(anon, "projector_state", { p_projector_token: s.projectorToken });
    expect(proj.question.winner.displayName).toBe("Bob");
    expect(proj.question.winner.choiceIndex).toBe(2);
    expect(proj.question.correctIndex).toBe(2);
    expect((await playerState(s.sessionId, bob!)).me.score).toBe(1);
    // Manual progression by default in buzzer mode.
    const [row] = await as<{ phase_ends_at: string | null }>(su, "select phase_ends_at from game_sessions where id = $1", [s.sessionId]);
    expect(row!.phase_ends_at).toBeNull();
  });

  it("resolves simultaneous correct presses to exactly one winner and one award", async () => {
    const s = await launch(1);
    const players = await joinPlayers(s.joinToken, Array.from({ length: 40 }, (_, i) => `Racer ${i + 1}`));
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    const results = await Promise.allSettled(players.map((p) => submit(s.sessionId, p, r1, 2)));
    const won = results.filter((r) => r.status === "fulfilled" && (r.value as any).result === "won");
    expect(won).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBe(39);
    for (const r of rejected) expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/CQ:question_closed/);

    const [ev] = await as<{ n: number }>(su, "select count(*)::int n from score_events where round_id = $1", [r1]);
    expect(ev!.n).toBe(1);
    const [round] = await as<{ winner_participant_id: string; close_reason: string }>(su,
      "select winner_participant_id, close_reason from session_rounds where id = $1", [r1]);
    expect(round!.close_reason).toBe("winner");
    const [ans] = await as<{ n: number }>(su, "select count(*)::int n from answers where round_id = $1 and is_correct", [r1]);
    expect(ans!.n).toBe(1);
    // Audit trail of the win.
    const [audit] = await as<{ n: number }>(su, "select count(*)::int n from audit_log where session_id = $1 and action = 'buzzer.win'", [s.sessionId]);
    expect(audit!.n).toBe(1);
  });

  it("closes with no winner when every eligible player answered wrong", async () => {
    const s = await launch(1);
    const [ann, bob] = await joinPlayers(s.joinToken, ["Ann", "Bob"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 0);
    await submit(s.sessionId, bob!, r1, 1);
    expect(await status(s.sessionId)).toBe("reveal");
    const proj = await rpc(anon, "projector_state", { p_projector_token: s.projectorToken });
    expect(proj.question.winner).toBeNull();
    expect(proj.question.closeReason).toBe("all_wrong");
    const [ev] = await as<{ n: number }>(su, "select count(*)::int n from score_events where session_id = $1", [s.sessionId]);
    expect(ev!.n).toBe(0);
  });

  it("allows retries when lockout is disabled", async () => {
    const s = await launch(1, { buzzerLockout: false });
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    expect((await submit(s.sessionId, ann!, r1, 0)).result).toBe("wrong");
    expect((await submit(s.sessionId, ann!, r1, 2)).result).toBe("won");
  });

  it("host can end a buzzer question with no winner and advance manually", async () => {
    const s = await launch(2);
    const [ann] = await joinPlayers(s.joinToken, ["Ann", "Bob"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 0);
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "close_question" });
    expect(await status(s.sessionId)).toBe("reveal");
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "next" });
    expect(await status(s.sessionId)).toBe("leaderboard");
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "next" });
    const r2 = await openCurrent(s.sessionId);
    expect(r2).not.toBe(r1);
  });

  it("a player who reconnects cannot submit a second attempt", async () => {
    const s = await launch(1);
    const [ann] = await joinPlayers(s.joinToken, ["Ann", "Bob"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 0);
    // "Reconnect": join again with the same device secret.
    const again = await rpc(anon, "join_session", { p_join_token: s.joinToken, p_display_name: "Ann", p_player_secret: ann!.secret });
    expect(again.participantId).toBe(ann!.participantId);
    expect(again.rejoined).toBe(true);
    const ps = await playerState(s.sessionId, ann!);
    expect(ps.myAnswers).toHaveLength(1);
    expect(ps.myAnswers[0].isCorrect).toBe(false);
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: ann!.secret, p_round_id: r1, p_choice_index: 2, p_submission_id: randomUUID(),
    })).toBe("locked_out");
  });
});
