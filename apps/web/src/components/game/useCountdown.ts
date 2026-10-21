"use client";

import { useEffect, useState } from "react";
import type { ServerClock } from "@crowdquiz/shared";

/**
 * Milliseconds left until a server timestamp, computed from the server
 * clock estimate (no independent local timer). Re-renders about every
 * 100ms while counting down.
 */
export function useCountdown(clock: ServerClock | null | undefined, deadline: string | null | undefined, frozenMs?: number | null) {
  const [, setTick] = useState(0);
  const frozen = frozenMs !== undefined && frozenMs !== null;
  useEffect(() => {
    if (frozen || !clock || !deadline) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const r = clock.remainingMs(deadline);
      const bucket = r === null ? -1 : Math.floor(r / 100);
      if (bucket !== last) {
        last = bucket;
        setTick((t) => t + 1);
      }
      if (r !== null && r > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, deadline, frozen]);
  if (frozen) return frozenMs;
  if (!clock || !deadline) return null;
  return clock.remainingMs(deadline);
}
