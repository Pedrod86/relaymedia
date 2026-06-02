// Trakt token storage (per device, localStorage) + small client helpers that
// proactively refresh the access token when it's near expiry.
import { traktRefresh } from "./trakt.functions";

const KEY = "trakt_session_v1";

export type TraktSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  user?: { username: string; name?: string; avatar?: string };
};

export function loadTraktSession(): TraktSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TraktSession) : null;
  } catch {
    return null;
  }
}

export function saveTraktSession(s: TraktSession) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("trakt:session"));
}

export function clearTraktSession() {
  localStorage.removeItem(KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("trakt:session"));
}

export function sessionFromToken(
  token: { access_token: string; refresh_token: string; expires_in: number; created_at: number },
  user?: TraktSession["user"]
): TraktSession {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: (token.created_at + token.expires_in) * 1000,
    user,
  };
}

/** Returns a valid access token, refreshing if it expires within 5 minutes. */
export async function getValidTraktToken(): Promise<string | null> {
  const s = loadTraktSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 5 * 60 * 1000) return s.accessToken;
  const refreshed = await traktRefresh({ data: { refreshToken: s.refreshToken } });
  if (!refreshed.ok) {
    clearTraktSession();
    return null;
  }
  saveTraktSession(sessionFromToken(refreshed, s.user));
  return refreshed.access_token;
}
