/**
 * Projector music and sound effects, synthesised live with the Web Audio API.
 * No audio files are shipped, so there is nothing to license.
 *
 * The music follows the game:
 *  - lobby / interlude: a relaxed loop
 *  - get-ready countdown: a beep per second and a short riser
 *  - question: a loop that builds with the share of time used, not the
 *    seconds left. At 90% of a 15 s timer and 90% of a 30 s timer the music
 *    is identical, so the final seconds feel the same whatever the timer.
 *    The last three seconds add a tick each second.
 *  - stingers for time up, a buzzer winner and the final results
 */

export type Scene = "silent" | "lobby" | "countdown" | "question" | "interlude";
export type Stinger = "timeUp" | "winner" | "finale";

export interface AudioFrame {
  scene: Scene;
  /** 0 = question just opened, 1 = time is up. Ignored outside "question". */
  intensity: number;
  /** Milliseconds left on the current timer, or null when there is none. */
  remainingMs: number | null;
}

/** Am – F – C – G, one chord per bar (MIDI note numbers). */
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const BASS_ROOTS = [45, 41, 36, 43];

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Musical parameters for a scene at a given intensity (pure, unit tested). */
export function musicParams(scene: Scene, intensity: number) {
  const p = clamp01(intensity);
  switch (scene) {
    case "lobby":
      return { bpm: 92, kick: [0, 8], hats: "offbeat8" as const, clap: false, roll: false, bass: true, cutoff: 700, arp: 0.05, riser: 0 };
    case "interlude":
      return { bpm: 100, kick: [0, 8], hats: "offbeat8" as const, clap: true, roll: false, bass: true, cutoff: 900, arp: 0.04, riser: 0 };
    case "question": {
      const curve = Math.pow(p, 1.15);
      return {
        bpm: Math.round(lerp(104, 156, curve)),
        kick: p >= 0.5 ? (p >= 0.85 ? [0, 4, 8, 12, 14] : [0, 4, 8, 12]) : [0, 8],
        hats: p >= 0.45 ? ("all16" as const) : p >= 0.15 ? ("offbeat8" as const) : ("none" as const),
        clap: p >= 0.3,
        roll: p >= 0.9,
        bass: true,
        cutoff: lerp(350, 3200, curve),
        arp: lerp(0.03, 0.09, curve),
        riser: Math.pow(p, 2.2) * 0.12,
      };
    }
    default:
      return null;
  }
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private riser: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  private lastTickSecond: number | null = null;
  private lastScene: Scene = "silent";
  private volume = 0.8;
  private source: () => AudioFrame = () => ({ scene: "silent", intensity: 0, remainingMs: null });

  /** Must be called from a user gesture (browsers block audio until then). */
  async unlock(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0;
      this.music.connect(this.master);
      this.noise = this.makeNoise();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (!this.timer) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.schedule(), 25);
    }
    return this.ctx.state === "running";
  }

  get unlocked(): boolean {
    return this.ctx?.state === "running";
  }

  setSource(fn: () => AudioFrame) {
    this.source = fn;
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  stinger(kind: Stinger) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.02;
    if (kind === "timeUp") {
      // A bright two-note "ding".
      this.tone(midiToHz(84), t, 0.5, "triangle", 0.22);
      this.tone(midiToHz(91), t + 0.12, 0.7, "triangle", 0.18);
      this.noiseHit(t, 0.35, 5000, 0.08, "highpass");
    } else if (kind === "winner") {
      [72, 76, 79, 84].forEach((m, i) => this.tone(midiToHz(m), t + i * 0.09, 0.35, "square", 0.08));
      [72, 76, 79, 84].forEach((m) => this.tone(midiToHz(m), t + 0.42, 0.9, "sawtooth", 0.05));
      this.kick(t + 0.42, 1);
    } else {
      // Finale: a short fanfare.
      const seq: Array<[number, number, number]> = [
        [67, 0, 0.18], [72, 0.18, 0.18], [76, 0.36, 0.18], [79, 0.54, 0.5], [76, 1.04, 0.16], [79, 1.2, 1.2],
      ];
      for (const [m, d, len] of seq) {
        this.tone(midiToHz(m), t + d, len, "square", 0.07);
        this.tone(midiToHz(m - 12), t + d, len, "sawtooth", 0.04);
      }
      [60, 64, 67, 72].forEach((m) => this.tone(midiToHz(m), t + 1.2, 1.6, "triangle", 0.06));
      this.kick(t + 1.2, 1);
      this.noiseHit(t + 1.2, 1.2, 6000, 0.06, "highpass");
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopRiser();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // ---- scheduling

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.music || ctx.state !== "running") return;
    const frame = this.source();
    const params = musicParams(frame.scene, frame.intensity);

    // Fade the music bed in or out with the scene.
    const target = params ? 0.9 : 0;
    this.music.gain.setTargetAtTime(target, ctx.currentTime, params ? 0.25 : 0.12);

    if (frame.scene !== this.lastScene) {
      if (frame.scene === "question" || frame.scene === "lobby") {
        this.step = 0;
        this.bar = 0;
      }
      this.lastTickSecond = null;
      this.lastScene = frame.scene;
    }

    this.countdownTicks(frame);
    this.updateRiser(params?.riser ?? 0, frame.intensity);

    if (!params) {
      this.nextStepTime = ctx.currentTime + 0.05;
      return;
    }
    const lookahead = 0.12;
    while (this.nextStepTime < ctx.currentTime + lookahead) {
      this.playStep(this.step, this.nextStepTime, params);
      const stepDur = 60 / params.bpm / 4;
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % PROGRESSION.length;
    }
  }

  private countdownTicks(frame: AudioFrame) {
    const ctx = this.ctx!;
    if (frame.remainingMs === null) return;
    const ticking = frame.scene === "countdown" || (frame.scene === "question" && frame.remainingMs <= 3000);
    if (!ticking || frame.remainingMs <= 0) return;
    const sec = Math.ceil(frame.remainingMs / 1000);
    if (sec !== this.lastTickSecond) {
      if (this.lastTickSecond !== null || frame.remainingMs % 1000 > 850) {
        const high = frame.scene === "countdown" ? sec === 1 : true;
        this.tone(midiToHz(high ? 88 : 81), ctx.currentTime + 0.01, 0.09, "square", frame.scene === "question" ? 0.09 : 0.07);
      }
      this.lastTickSecond = sec;
    }
  }

  private playStep(step: number, t: number, p: NonNullable<ReturnType<typeof musicParams>>) {
    const chord = PROGRESSION[this.bar]!;
    if (p.kick.includes(step)) this.kick(t, 0.9);
    if (p.hats === "all16" || (p.hats === "offbeat8" && step % 4 === 2)) {
      this.noiseHit(t, 0.04, 8000, step % 4 === 2 ? 0.07 : 0.035, "highpass");
    }
    if (p.clap && (step === 4 || step === 12)) this.noiseHit(t, 0.12, 1800, 0.12, "bandpass");
    if (p.roll) this.noiseHit(t, 0.06, 2200, 0.03 + (step / 16) * 0.06, "bandpass");
    if (p.bass && step % 2 === 0) {
      const root = BASS_ROOTS[this.bar]!;
      const note = step % 8 === 6 ? root + 12 : root;
      this.bassNote(midiToHz(note), t, 60 / 120 / 4 * 1.8, p.cutoff);
    }
    if (p.arp > 0) {
      const idx = [0, 1, 2, 1][step % 4]!;
      const octave = step >= 8 ? 12 : 0;
      this.tone(midiToHz(chord[idx]! + 12 + octave), t, 0.12, "triangle", p.arp, this.music!);
    }
  }

  // ---- instruments

  private tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.music ?? this.master!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private bassNote(freq: number, t: number, dur: number, cutoff: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.value = cutoff;
    f.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, freq: number, gain: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.music ?? this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private updateRiser(level: number, intensity: number) {
    const ctx = this.ctx!;
    if (level <= 0.001) {
      this.stopRiser();
      return;
    }
    if (!this.riser) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.music!);
      src.start();
      this.riser = { src, gain, filter };
    }
    this.riser.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.1);
    this.riser.filter.frequency.setTargetAtTime(lerp(400, 6000, clamp01(intensity)), ctx.currentTime, 0.1);
  }

  private stopRiser() {
    if (!this.riser || !this.ctx) {
      this.riser = null;
      return;
    }
    const { src, gain } = this.riser;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    src.stop(this.ctx.currentTime + 0.3);
    this.riser = null;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
