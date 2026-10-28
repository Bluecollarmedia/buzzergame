import { describe, expect, it } from "vitest";
import { ServerClock, buildJoinUrl, buildQuestionImageUrl, displaySeconds, generatePlayerSecret, parseJoinInput, uuidv4 } from "../index";

const token = "abcdefghijklmnopqrstuvwx";

describe("join links", () => {
  it("builds and parses https join URLs", () => {
    const url = buildJoinUrl("https://play.example.com/", token);
    expect(url).toBe(`https://play.example.com/j/${token}`);
    expect(parseJoinInput(url)).toEqual({ kind: "token", joinToken: token });
  });
  it("parses app deep links", () => {
    expect(parseJoinInput(`crowdquiz://j/${token}`)).toEqual({ kind: "token", joinToken: token });
  });
  it("parses room codes", () => {
    expect(parseJoinInput("abc 234")).toEqual({ kind: "room", roomCode: "ABC234" });
  });
  it("rejects foreign hosts and junk", () => {
    expect(parseJoinInput(`https://evil.example/j/${token}`, ["play.example.com"])).toEqual({ kind: "invalid" });
    expect(parseJoinInput("https://play.example.com/other")).toEqual({ kind: "invalid" });
    expect(parseJoinInput("hello")).toEqual({ kind: "invalid" });
    expect(parseJoinInput("javascript:alert(1)")).toEqual({ kind: "invalid" });
  });
});

describe("server clock", () => {
  it("estimates offset from the round trip midpoint", () => {
    let now = 10_000;
    const c = new ServerClock(() => now);
    // Request sent at 10000, answered at 10200, server said 15100.
    c.addSample(new Date(15_100).toISOString(), 10_000, 10_200);
    expect(c.offsetMs).toBe(5000);
    now = 10_200;
    expect(c.remainingMs(new Date(16_200).toISOString())).toBe(1000);
    expect(c.remainingMs(new Date(1000).toISOString())).toBe(0);
  });
  it("prefers samples with the shortest round trip", () => {
    const c = new ServerClock(() => 0);
    c.addSample(new Date(2000).toISOString(), 0, 2000); // rtt 2000, offset 1000
    for (let i = 0; i < 3; i++) c.addSample(new Date(5050).toISOString(), 0, 100); // rtt 100, offset 5000
    expect(c.offsetMs).toBe(5000);
  });
  it("displays whole seconds rounded up", () => {
    expect(displaySeconds(14_001)).toBe(15);
    expect(displaySeconds(0)).toBe(0);
    expect(displaySeconds(null)).toBeNull();
  });
});

describe("random", () => {
  it("generates player secrets that satisfy the server format", () => {
    const s = generatePlayerSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generatePlayerSecret()).not.toBe(s);
  });
  it("generates v4 uuids", () => {
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("question photo address", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  it("builds the public storage address and rejects odd paths", () => {
    expect(buildQuestionImageUrl("https://play.example.com/", `${id}/${id}.jpg`)).toBe(`https://play.example.com/photos/${id}/${id}.jpg`);
    expect(buildQuestionImageUrl("", `${id}/${id}.jpg`)).toBe(`/photos/${id}/${id}.jpg`);
    expect(buildQuestionImageUrl("https://play.example.com", "../secret.jpg")).toBeNull();
    expect(buildQuestionImageUrl("https://play.example.com", null)).toBeNull();
  });
});
