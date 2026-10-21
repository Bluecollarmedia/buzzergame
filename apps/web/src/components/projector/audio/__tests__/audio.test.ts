import { describe, expect, it } from "vitest";
import { ServerClock, type ProjectorState } from "@crowdquiz/shared";
import { musicParams } from "../GameAudio";
import { audioFrame } from "../useGameAudio";

function questionState(startedAt: number, seconds: number): ProjectorState {
  return {
    serverNow: new Date(startedAt).toISOString(),
    session: {
      id: "s", title: "t", mode: "multiple_choice", status: "question_open", pausedFrom: null, pausedRemainingMs: null,
      questionCount: 3, currentPosition: 0, phaseEndsAt: null, stateVersion: 1, startedAt: null, endedAt: null, playerCount: 4,
      settings: { soundOn: true },
    },
    join: null,
    players: null,
    question: {
      position: 0, roundId: "r", startedAt: new Date(startedAt).toISOString(),
      deadline: new Date(startedAt + seconds * 1000).toISOString(), roundStatus: "open",
    },
    leaderboard: null,
    results: null,
  } as ProjectorState;
}

/** A clock frozen at a fixed server time. */
function clockAt(now: number): ServerClock {
  const c = new ServerClock(() => now);
  return c;
}

describe("projector music", () => {
  it("is equally intense at the same share of a 15 s and a 30 s timer", () => {
    const t0 = 1_000_000;
    const f15 = audioFrame(questionState(t0, 15), clockAt(t0 + 13_500));
    const f30 = audioFrame(questionState(t0, 30), clockAt(t0 + 27_000));
    expect(f15.intensity).toBeCloseTo(0.9, 5);
    expect(f30.intensity).toBeCloseTo(0.9, 5);
    expect(musicParams("question", f15.intensity)).toEqual(musicParams("question", f30.intensity));
  });

  it("builds from calm to intense as time runs out", () => {
    const start = musicParams("question", 0)!;
    const end = musicParams("question", 1)!;
    expect(end.bpm).toBeGreaterThan(start.bpm);
    expect(end.cutoff).toBeGreaterThan(start.cutoff);
    expect(end.kick.length).toBeGreaterThan(start.kick.length);
    expect(end.roll).toBe(true);
    expect(start.roll).toBe(false);
  });

  it("goes quiet while paused", () => {
    const st = questionState(0, 15);
    st.session.status = "paused";
    expect(audioFrame(st, clockAt(5000)).scene).toBe("silent");
  });

  it("keeps a steady tension for an untimed buzzer question", () => {
    const st = questionState(0, 15);
    st.session.mode = "color_buzzer";
    st.question!.deadline = null;
    const f = audioFrame(st, clockAt(5000));
    expect(f).toEqual({ scene: "question", intensity: 0.5, remainingMs: null });
  });
});
