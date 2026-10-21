import * as SecureStore from "expo-secure-store";

/**
 * The player's per-game secret lives in the device keychain / keystore.
 * It is the only thing that identifies the player, so it is how a player
 * gets back into the same game after the app is closed.
 */
export interface StoredPlayer {
  sessionId: string;
  secret: string;
  participantId?: string;
  displayName?: string;
  savedAt: number;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const key = (joinToken: string) => `cq.player.${joinToken.replace(/[^A-Za-z0-9._-]/g, "_")}`;

export async function loadPlayer(joinToken: string): Promise<StoredPlayer | null> {
  try {
    const raw = await SecureStore.getItemAsync(key(joinToken));
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredPlayer;
    if (!p.secret || !p.sessionId || Date.now() - p.savedAt > MAX_AGE_MS) {
      await clearPlayer(joinToken);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function savePlayer(joinToken: string, p: StoredPlayer): Promise<void> {
  await SecureStore.setItemAsync(key(joinToken), JSON.stringify(p));
}

export async function clearPlayer(joinToken: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(joinToken)).catch(() => {});
}
