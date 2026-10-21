/**
 * Estimates the offset between this device's clock and the server clock so
 * countdowns are computed from the server deadline, not a local timer.
 *
 * offset = serverTime - localTime. Each sample comes from a request whose
 * round trip is measured; samples with the shortest round trip are the most
 * accurate, so we keep the best few.
 */
export class ServerClock {
  private samples: Array<{ offset: number; rtt: number }> = [];
  private _offset = 0;

  constructor(private now: () => number = () => Date.now()) {}

  get offsetMs(): number {
    return this._offset;
  }

  /** Record a sample from a request sent at t0 and answered at t1 (local ms). */
  addSample(serverTimeIso: string, t0: number, t1: number): void {
    const server = Date.parse(serverTimeIso);
    if (!Number.isFinite(server) || t1 < t0) return;
    const rtt = t1 - t0;
    // Assume the server read its clock half-way through the round trip.
    const offset = server - (t0 + rtt / 2);
    this.samples.push({ offset, rtt });
    this.samples.sort((a, b) => a.rtt - b.rtt);
    this.samples = this.samples.slice(0, 5);
    const best = this.samples.slice(0, 3);
    this._offset = best.reduce((s, x) => s + x.offset, 0) / best.length;
  }

  /** Current time on the server's clock (estimate). */
  serverNow(): number {
    return this.now() + this._offset;
  }

  /** Milliseconds until a server timestamp, never negative. */
  remainingMs(deadlineIso: string | null | undefined): number | null {
    if (!deadlineIso) return null;
    const d = Date.parse(deadlineIso);
    if (!Number.isFinite(d)) return null;
    return Math.max(0, d - this.serverNow());
  }

  /** Local timestamp (ms) corresponding to a server timestamp. */
  toLocal(serverIso: string): number {
    return Date.parse(serverIso) - this._offset;
  }

  get sampleCount(): number {
    return this.samples.length;
  }
}

/** Seconds to display for a countdown (ceil so "1" shows until the end). */
export function displaySeconds(remainingMs: number | null): number | null {
  if (remainingMs === null) return null;
  return Math.ceil(remainingMs / 1000);
}
