/** Random helpers that work in browsers, Node and React Native. */

export type RandomBytes = (n: number) => Uint8Array;

export const defaultRandomBytes: RandomBytes = (n) => {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) {
    throw new Error("Secure random numbers are not available on this device.");
  }
  return c.getRandomValues(new Uint8Array(n));
};

function base64url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + alphabet[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]!;
  }
  return out;
}

/**
 * The secret a player's device keeps for one session. Only its SHA-256 hash
 * is stored on the server. 32 bytes => 43 URL-safe characters.
 */
export function generatePlayerSecret(random: RandomBytes = defaultRandomBytes): string {
  return base64url(random(32));
}

/** RFC 4122 version 4 UUID (used as submission idempotency keys). */
export function uuidv4(random: RandomBytes = defaultRandomBytes): string {
  const b = random(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
