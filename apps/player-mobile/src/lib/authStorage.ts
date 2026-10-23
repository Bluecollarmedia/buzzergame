import * as SecureStore from "expo-secure-store";

/**
 * Supabase keeps the signed-in session as one JSON string that can be longer
 * than a single secure-store item allows, so it is saved in pieces. The
 * session never leaves the iOS Keychain / Android Keystore.
 */
const CHUNK = 1800;
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await SecureStore.getItemAsync(`${safe(key)}.n`);
      if (!count) return null;
      const parts: string[] = [];
      for (let i = 0; i < Number(count); i++) {
        const part = await SecureStore.getItemAsync(`${safe(key)}.${i}`);
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await authStorage.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(`${safe(key)}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(`${safe(key)}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    try {
      const count = Number((await SecureStore.getItemAsync(`${safe(key)}.n`)) ?? 0);
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${safe(key)}.${i}`);
      await SecureStore.deleteItemAsync(`${safe(key)}.n`);
    } catch {
      /* nothing stored */
    }
  },
};
