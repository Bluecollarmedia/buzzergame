/**
 * Join links. The QR code contains an HTTPS URL of the form
 *   https://<web-host>/j/<joinToken>
 * The native app claims /j/* through universal links / Android app links,
 * and also understands crowdquiz://j/<joinToken>. Without the app, the URL
 * opens the browser player.
 */
export const APP_SCHEME = "crowdquiz";
export const JOIN_PATH_PREFIX = "/j/";

const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
const ROOM_RE = /^[A-Z2-9]{6}$/;

export function buildJoinUrl(baseUrl: string, joinToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${JOIN_PATH_PREFIX}${encodeURIComponent(joinToken)}`;
}

export function buildProjectorUrl(baseUrl: string, projectorToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/present/${encodeURIComponent(projectorToken)}`;
}

export function isJoinToken(s: string): boolean {
  return TOKEN_RE.test(s);
}

export function normalizeRoomCode(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isRoomCode(s: string): boolean {
  return ROOM_RE.test(normalizeRoomCode(s));
}

export type ParsedJoinInput =
  | { kind: "token"; joinToken: string }
  | { kind: "room"; roomCode: string }
  | { kind: "invalid" };

/**
 * Interpret a scanned QR payload or typed text: a join URL, an app deep
 * link, a bare join token or a 6-character room code.
 */
export function parseJoinInput(raw: string, allowedHosts?: string[]): ParsedJoinInput {
  const text = raw.trim();
  if (!text) return { kind: "invalid" };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (url.protocol === "https:" || url.protocol === "http:") {
        if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(url.host)) {
          return { kind: "invalid" };
        }
        const m = /^\/j\/([^/?#]+)\/?$/.exec(url.pathname);
        if (m?.[1] && isJoinToken(decodeURIComponent(m[1]))) {
          return { kind: "token", joinToken: decodeURIComponent(m[1]) };
        }
        return { kind: "invalid" };
      }
      if (url.protocol === `${APP_SCHEME}:`) {
        // crowdquiz://j/<token> parses with host "j".
        const path = `${url.host}${url.pathname}`.replace(/^\/+/, "");
        const m = /^j\/([^/?#]+)\/?$/.exec(path);
        if (m?.[1] && isJoinToken(decodeURIComponent(m[1]))) {
          return { kind: "token", joinToken: decodeURIComponent(m[1]) };
        }
      }
    } catch {
      return { kind: "invalid" };
    }
    return { kind: "invalid" };
  }

  if (isRoomCode(text)) return { kind: "room", roomCode: normalizeRoomCode(text) };
  if (isJoinToken(text)) return { kind: "token", joinToken: text };
  return { kind: "invalid" };
}

/** Format a room code for display: "ABC 123". */
export function formatRoomCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
