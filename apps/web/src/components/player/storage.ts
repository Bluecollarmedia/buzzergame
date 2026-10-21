/**
 * Per-session guest credentials kept on the device so a player can reconnect
 * after a refresh or network drop. Only the player's own random secret is
 * stored; it grants nothing beyond playing as this guest in this session.
 */
export interface StoredPlayer {
  sessionId: string;
  secret: string;
  participantId?: string;
  displayName?: string;
  savedAt: number;
}

const key = (joinToken: string) => `cq:player:${joinToken}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadPlayer(joinToken: string): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(key(joinToken));
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredPlayer;
    if (Date.now() - p.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key(joinToken));
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function savePlayer(joinToken: string, p: StoredPlayer) {
  try {
    localStorage.setItem(key(joinToken), JSON.stringify(p));
  } catch {
    /* private mode: the player can still play, but not reconnect after reload */
  }
}

export function clearPlayer(joinToken: string) {
  try {
    localStorage.removeItem(key(joinToken));
  } catch {
    /* ignore */
  }
}
