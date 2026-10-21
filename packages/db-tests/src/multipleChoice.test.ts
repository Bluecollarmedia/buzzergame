import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  anon, as, createQuiz, createUser, expirePhase, grantAccess, host, joinPlayers, openCurrent, playerState,
  rpc, rpcError, startToFirstQuestion, status, submit, su, tick,
} from "./db";
import { mcQuiz } from "./fixtures";

let uid: string;
beforeEach(async () => {
  uid = await createUser();
  await grantAccess(uid);
});

async function launch(n = 3, settings: Record<string, unknown> = {}) {
  const quizId = await createQuiz(uid, mcQuiz(n, settings));
  return rpc(host(uid), "create_session", { p_quiz_id: quizId, p_settings: {} });
}

describe("multiple choice game", () => {
  it("plays a full game with server-side scoring and automatic progression", async () => {
    const s = await launch(2);
    const [ann, bob, cat] = await joinPlayers(s.joinToken, ["Ann", "Bob", "Cat"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);

    // Question 1: correct answer is index 0.
    const ps = await playerState(s.sessionId, ann!);
    expect(ps.question.prompt).toBeNull(); // the phone never gets the question
    expect(ps.question.correctIndex).toBeNull(); // nor the answer while open
    expect(ps.question.deadline).toBeTruthy();

    expect((await submit(s.sessionId, ann!, r1, 0)).result).toBe("accepted");
    expect((await submit(s.sessionId, bob!, r1, 2)).result).toBe("accepted");
    // Correctness is not revealed in the submit response.
    const acc = await submit(s.sessionId, cat!, r1, 0);
    expect(acc).not.toHaveProperty("isCorrect");

    await expirePhase(s.sessionId);
    await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("reveal");

    const after = await playerState(s.sessionId, ann!);
    expect(after.question.correctIndex).toBe(0);
    expect(after.myRoundPoints).toBe(1);
    expect(after.me.score).toBe(1);
    expect((await playerState(s.sessionId, bob!)).myRoundPoints).toBe(0);

    // reveal -> leaderboard -> countdown -> question 2, all driven by the clock.
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("leaderboard");
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("countdown");
    const r2 = await openCurrent(s.sessionId);
    expect(r2).not.toBe(r1);

    // Question 2: correct answer is index 1. Bob answers correctly.
    await submit(s.sessionId, bob!, r2, 1);
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("reveal");
    // Last question: reveal goes straight to final results.
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("finished");

    const results = await rpc(host(uid), "session_results", { p_session_id: s.sessionId });
    const byName = Object.fromEntries(results.standings.map((r: any) => [r.displayName, r]));
    expect(byName.Ann.score).toBe(1);
    expect(byName.Bob.score).toBe(1);
    expect(byName.Cat.score).toBe(1);
    // Three-way tie: everyone shares first place.
    expect(results.standings.every((r: any) => r.rank === 1)).toBe(true);
    expect(byName.Ann.answeredCount).toBe(1);
    expect(results.questionsPlayed).toBe(2);

    // The leaderboard matches the scoring ledger exactly.
    const ledger = await as<{ name: string; total: number }>(su,
      `select p.display_name as name, sum(e.points)::int as total from score_events e
       join participants p on p.id = e.participant_id where e.session_id = $1 group by 1`, [s.sessionId]);
    for (const row of ledger) expect(byName[row.name].score).toBe(row.total);

    // Final results are persisted on the session.
    const [persisted] = await as<{ final_results: any }>(su, "select final_results from game_sessions where id = $1", [s.sessionId]);
    expect(persisted!.final_results.standings).toHaveLength(3);
  });

  it("rejects answers after the deadline even if the phase has not advanced yet", async () => {
    const s = await launch(1);
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await expirePhase(s.sessionId); // nobody has ticked; status is still question_open
    expect(await status(s.sessionId)).toBe("question_open");
    const code = await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: ann!.secret, p_round_id: r1, p_choice_index: 0, p_submission_id: randomUUID(),
    });
    // The submission itself closed the question on the server, then was rejected.
    expect(["too_late", "question_closed"]).toContain(code);
    expect(await status(s.sessionId)).toBe("reveal");
    const ps = await playerState(s.sessionId, ann!);
    expect(ps.myAnswers).toHaveLength(0);
    expect(ps.me.score).toBe(0);
  });

  it("treats a retried submission as the same answer and blocks a second answer", async () => {
    const s = await launch(1);
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    const sub = randomUUID();
    expect((await submit(s.sessionId, ann!, r1, 0, sub)).result).toBe("accepted");
    expect((await submit(s.sessionId, ann!, r1, 0, sub)).result).toBe("duplicate");
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: ann!.secret, p_round_id: r1, p_choice_index: 1, p_submission_id: randomUUID(),
    })).toBe("already_answered");
    await expirePhase(s.sessionId); await tick(s.sessionId);
    const [cnt] = await as<{ n: number }>(su, "select count(*)::int n from score_events where session_id = $1", [s.sessionId]);
    expect(cnt!.n).toBe(1);
  });

  it("allows changing an answer before the deadline only when enabled", async () => {
    const s = await launch(1, { allowAnswerChange: true });
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 2);
    expect((await submit(s.sessionId, ann!, r1, 0)).result).toBe("changed");
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect((await playerState(s.sessionId, ann!)).me.score).toBe(1);
  });

  it("concurrent answers from many players are all recorded once", async () => {
    const s = await launch(1);
    const players = await joinPlayers(s.joinToken, Array.from({ length: 30 }, (_, i) => `Player ${i + 1}`));
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    const sub = players.map(() => randomUUID());
    // Every player submits twice at the same time (double tap / retry).
    const results = await Promise.allSettled(players.flatMap((p, i) => [
      submit(s.sessionId, p, r1, i % 4, sub[i]), submit(s.sessionId, p, r1, i % 4, sub[i]),
    ]));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const [cnt] = await as<{ n: number }>(su, "select count(*)::int n from answers where round_id = $1", [r1]);
    expect(cnt!.n).toBe(30);
    await expirePhase(s.sessionId); await tick(s.sessionId);
    const [pts] = await as<{ n: number }>(su, "select count(*)::int n from score_events where round_id = $1", [r1]);
    expect(pts!.n).toBe(8); // indexes 0,4,8,...,28
  });

  it("pause freezes the question and resume restores the remaining time", async () => {
    const s = await launch(1);
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    let st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "pause", p_expected_version: st.session.stateVersion });
    expect(await status(s.sessionId)).toBe("paused");
    expect(await rpcError(anon, "submit_answer", {
      p_session_id: s.sessionId, p_player_secret: ann!.secret, p_round_id: r1, p_choice_index: 0, p_submission_id: randomUUID(),
    })).toBe("game_paused");
    // Ticking while paused never advances the game.
    await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("paused");
    const [paused] = await as<{ paused_remaining_ms: number }>(su, "select paused_remaining_ms from game_sessions where id = $1", [s.sessionId]);
    expect(paused!.paused_remaining_ms).toBeGreaterThan(10000);

    st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "resume", p_expected_version: st.session.stateVersion });
    expect(await status(s.sessionId)).toBe("question_open");
    const [row] = await as<{ ms: number; rd: boolean }>(su,
      `select extract(epoch from (g.question_deadline - clock_timestamp()))*1000 as ms, g.question_deadline = r.deadline as rd
       from game_sessions g join session_rounds r on r.id = g.current_round_id where g.id = $1`, [s.sessionId]);
    expect(Number(row!.ms)).toBeGreaterThan(10000);
    expect(row!.rd).toBe(true);
    expect((await submit(s.sessionId, ann!, r1, 0)).result).toBe("accepted");
  });

  it("ignores repeated host commands (double click / two devices)", async () => {
    const s = await launch(2);
    await joinPlayers(s.joinToken, ["Ann"]);
    const st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    const v = st.session.stateVersion;
    const [a, b] = await Promise.all([
      rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "start", p_expected_version: v }),
      rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "start", p_expected_version: v }),
    ]);
    expect([a.applied, b.applied].sort()).toEqual([false, true]);
    const [rounds] = await as<{ n: number }>(su, "select count(*)::int n from session_rounds where session_id = $1", [s.sessionId]);
    expect(rounds!.n).toBeLessThanOrEqual(1);
    expect(await status(s.sessionId)).toBe("countdown");
  });

  it("replaying a question voids its earlier points instead of duplicating them", async () => {
    const s = await launch(2);
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 0);
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect((await playerState(s.sessionId, ann!)).me.score).toBe(1);

    let st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "replay", p_expected_version: st.session.stateVersion });
    expect((await playerState(s.sessionId, ann!)).me.score).toBe(0);
    const r1b = await openCurrent(s.sessionId);
    expect(r1b).not.toBe(r1);
    await submit(s.sessionId, ann!, r1b, 0);
    await expirePhase(s.sessionId); await tick(s.sessionId);
    expect((await playerState(s.sessionId, ann!)).me.score).toBe(1);

    // Skip the second question while it is open: no points, game ends.
    st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "next", p_expected_version: st.session.stateVersion });
    expect(await status(s.sessionId)).toBe("leaderboard");
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "next" });
    const r2 = await openCurrent(s.sessionId);
    await submit(s.sessionId, ann!, r2, 1);
    st = await rpc(host(uid), "host_state", { p_session_id: s.sessionId });
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "skip", p_expected_version: st.session.stateVersion });
    expect(await status(s.sessionId)).toBe("finished");
    const res = await rpc(host(uid), "session_results", { p_session_id: s.sessionId });
    expect(res.standings[0].score).toBe(1);
    expect(res.questionsPlayed).toBe(1);
  });

  it("a finished session cannot be restarted or controlled", async () => {
    const s = await launch(1);
    await joinPlayers(s.joinToken, ["Ann"]);
    await startToFirstQuestion(uid, s.sessionId);
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "end" });
    expect(await status(s.sessionId)).toBe("finished");
    expect(await rpcError(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "start" })).toBe("session_ended");
    await tick(s.sessionId);
    expect(await status(s.sessionId)).toBe("finished");
  });

  it("cannot start without players and ending an unstarted lobby cancels it", async () => {
    const s = await launch(1);
    expect(await rpcError(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "start" })).toBe("no_players");
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "end" });
    expect(await status(s.sessionId)).toBe("aborted");
  });

  it("speed bonus is applied by the server when enabled", async () => {
    const s = await launch(1, { speedBonus: true, speedBonusMaxPoints: 10 });
    const [ann] = await joinPlayers(s.joinToken, ["Ann"]);
    const r1 = await startToFirstQuestion(uid, s.sessionId);
    await submit(s.sessionId, ann!, r1, 0);
    // Close by host so the original deadline is used for the bonus.
    await rpc(host(uid), "host_command", { p_session_id: s.sessionId, p_command: "close_question" });
    const [ev] = await as<{ base_points: number; bonus_points: number }>(su, "select base_points, bonus_points from score_events where round_id = $1", [r1]);
    expect(ev!.base_points).toBe(1);
    expect(ev!.bonus_points).toBeGreaterThanOrEqual(9);
  });
});
