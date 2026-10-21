import { getRandomValues } from "expo-crypto";

// The shared package uses crypto.getRandomValues for player secrets and
// submission ids. Hermes does not provide it, so back it with expo-crypto
// (a cryptographically secure native source).
const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = getRandomValues;
}
