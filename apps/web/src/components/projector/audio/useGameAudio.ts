"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectorState, ServerClock } from "@crowdquiz/shared";
import { GameAudio, type AudioFrame } from "./GameAudio";

const PREF_KEY = "cq:projector:sound";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}
function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

/** Work out what the music should be doing right now from the game state. */
export function audioFrame(state: ProjectorState | null, clock: ServerClock | null): AudioFrame {
  const s = state?.session;
  if (!s || s.status === "paused" || s.status === "aborted") return { scene: "silent", intensity: 0, remainingMs: null };
  const q = state.question;
  switch (s.status) {
    case "lobby":
      return { scene: "lobby", intensity: 0, remainingMs: null };
    case "countdown":
      return { scene: "countdown", intensity: 0, remainingMs: clock?.remainingMs(s.phaseEndsAt) ?? null };
    case "question_open": {
      if (q?.deadline && q.startedAt) {
        const total = Date.parse(q.deadline) - Date.parse(q.startedAt);
        const left = clock?.remainingMs(q.deadline) ?? total;
        const intensity = total > 0 ? 1 - Math.max(0, left) / total : 1;
        return { scene: "question", intensity, remainingMs: left };
      }
      // Color Buzzer with no timer: steady tension, no build.
      return { scene: "question", intensity: 0.5, remainingMs: null };
    }
    case "reveal":
    case "leaderboard":
      return { scene: "interlude", intensity: 0, remainingMs: null };
    case "finished":
      return { scene: "lobby", intensity: 0, remainingMs: null };
    default:
      return { scene: "silent", intensity: 0, remainingMs: null };
  }
}

/**
 * Drives the projector's music. Sound plays only when the host has it on for
 * this game AND this screen has been unlocked by a click (browser rule).
 */
export function useGameAudio(state: ProjectorState | null, clock: ServerClock | null) {
  const engineRef = useRef<GameAudio | null>(null);
  const stateRef = useRef(state);
  const clockRef = useRef(clock);
  const [localOn, setLocalOn] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const hostOn = state?.session.settings.soundOn !== false;
  const active = hostOn && localOn;

  useEffect(() => {
    stateRef.current = state;
    clockRef.current = clock;
  }, [state, clock]);

  useEffect(() => {
    const engine = new GameAudio();
    engineRef.current = engine;
    const pref = readPref();
    queueMicrotask(() => setLocalOn(pref));
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Feed the engine live frames (it polls ~40 times a second).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setSource(() => (active ? audioFrame(stateRef.current, clockRef.current) : { scene: "silent", intensity: 0, remainingMs: null }));
  }, [active]);

  // One-shot sounds on transitions.
  const prev = useRef<{ status: string; roundKey: string | null } | null>(null);
  const s = state?.session;
  const q = state?.question;
  useEffect(() => {
    if (!s) return;
    const roundKey = q?.roundId ? `${q.roundId}` : null;
    const before = prev.current;
    prev.current = { status: s.status, roundKey };
    if (!before || !active) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (s.status === "reveal" && before.status !== "reveal") {
      engine.stinger(s.mode === "color_buzzer" && q?.winner ? "winner" : "timeUp");
    } else if (s.status === "finished" && before.status !== "finished") {
      engine.stinger("finale");
    }
  }, [s, q, active]);

  const enable = useCallback(async () => {
    setLocalOn(true);
    writePref(true);
    const ok = (await engineRef.current?.unlock()) ?? false;
    setUnlocked(ok);
  }, []);

  const toggle = useCallback(async () => {
    if (!localOn || !unlocked) return enable();
    setLocalOn(false);
    writePref(false);
  }, [enable, localOn, unlocked]);

  return {
    /** Host turned sound on for this game. */
    hostOn,
    /** Sound is on for this screen and audible. */
    playing: active && unlocked,
    /** Sound wanted but the browser needs a click first. */
    needsClick: active && !unlocked,
    toggle,
    enable,
  };
}
