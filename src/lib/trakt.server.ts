// Server-only Trakt credential store + API client.
//
// Trakt access/refresh tokens are account credentials, so they are treated
// exactly like media-server tokens: sealed with MEDIA_VAULT_SECRET and kept in
// an httpOnly cookie browser JavaScript can never read. The app's Trakt client
// id/secret stay in server env (TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET) and are
// only ever read inside a handler — never shipped to the browser.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { openJson, sealJson } from "./vault.server";

export const TRAKT_COOKIE = "tk_creds";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const TRAKT_API_BASE = "https://api.trakt.tv";

export type TraktCredential = {
  accessToken: string;
  refreshToken: string;
  /** Unix ms when the access token stops working. */
  expiresAt: number;
  username: string;
  connectedAt: string;
};

export type PublicTrakt = {
  connected: true;
  username: string;
  connectedAt: string;
  expiresAt: number;
};

export function toPublicTrakt(c: TraktCredential): PublicTrakt {
  return {
    connected: true,
    username: c.username,
    connectedAt: c.connectedAt,
    expiresAt: c.expiresAt,
  };
}

/** App-level Trakt API credentials. Read per-request (Workers bind env late). */
export function traktApp() {
  const clientId = process.env["TRAKT_CLIENT_ID"];
  const clientSecret = process.env["TRAKT_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("TRAKT_NOT_CONFIGURED");
  return { clientId, clientSecret };
}

export async function readTrakt(): Promise<TraktCredential | null> {
  const raw = getCookie(TRAKT_COOKIE);
  if (!raw) return null;
  return openJson<TraktCredential>(raw);
}

export async function writeTrakt(cred: TraktCredential | null) {
  setCookie(TRAKT_COOKIE, cred ? await sealJson(cred) : "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cred ? MAX_AGE_SECONDS : 0,
  });
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
};

export function credFromToken(token: TokenResponse, username: string): TraktCredential {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: (token.created_at + token.expires_in) * 1000,
    username,
    connectedAt: new Date().toISOString(),
  };
}

async function traktPost(path: string, body: unknown) {
  const { clientId } = traktApp();
  const res = await fetch(`${TRAKT_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** Step 1 of the device flow: ask Trakt for a user code. */
export async function requestDeviceCode() {
  const { clientId } = traktApp();
  const r = await traktPost("/oauth/device/code", { client_id: clientId });
  if (!r.ok) {
    console.error(`Trakt device/code failed [${r.status}]: ${r.text.slice(0, 200)}`);
    throw new Error(`Trakt refused the pairing request (${r.status}).`);
  }
  return r.json as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };
}

export type PollOutcome =
  | { state: "authorized"; cred: TraktCredential }
  | { state: "pending" }
  | { state: "slow_down" }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "error"; error: string };

/** Step 2: exchange the device code once the user has approved it. */
export async function pollDeviceToken(deviceCode: string): Promise<PollOutcome> {
  const { clientId, clientSecret } = traktApp();
  const r = await traktPost("/oauth/device/token", {
    code: deviceCode,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (r.ok && r.json?.access_token) {
    const username = await fetchUsername(r.json.access_token);
    return { state: "authorized", cred: credFromToken(r.json, username) };
  }
  switch (r.status) {
    case 400:
      return { state: "pending" };
    case 409: // already used
      return { state: "error", error: "That code was already used. Start again." };
    case 410:
      return { state: "expired" };
    case 418:
      return { state: "denied" };
    case 429:
      return { state: "slow_down" };
    default:
      console.error(`Trakt device/token failed [${r.status}]: ${r.text.slice(0, 200)}`);
      return { state: "error", error: `Trakt returned ${r.status}.` };
  }
}

async function refresh(cred: TraktCredential): Promise<TraktCredential> {
  const { clientId, clientSecret } = traktApp();
  const r = await traktPost("/oauth/token", {
    refresh_token: cred.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
    grant_type: "refresh_token",
  });
  if (!r.ok || !r.json?.access_token) {
    console.error(`Trakt token refresh failed [${r.status}]: ${r.text.slice(0, 200)}`);
    throw new Error("TRAKT_REAUTH_REQUIRED");
  }
  return credFromToken(r.json, cred.username);
}

/**
 * Current credential, refreshed (and re-sealed into the cookie) when the
 * access token is within a day of expiry.
 */
export async function requireTrakt(): Promise<TraktCredential> {
  const cred = await readTrakt();
  if (!cred) throw new Error("TRAKT_NOT_CONNECTED");
  if (cred.expiresAt - Date.now() > 24 * 60 * 60 * 1000) return cred;
  const next = await refresh(cred);
  await writeTrakt(next);
  return next;
}

async function traktAuthedFetch(
  cred: TraktCredential,
  path: string,
  init: RequestInit = {},
) {
  const { clientId } = traktApp();
  const res = await fetch(`${TRAKT_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      Authorization: `Bearer ${cred.accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

async function fetchUsername(accessToken: string): Promise<string> {
  const { clientId } = traktApp();
  try {
    const res = await fetch(`${TRAKT_API_BASE}/users/settings`, {
      headers: {
        Accept: "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return "Trakt account";
    const json: any = await res.json();
    return json?.user?.username ?? json?.user?.ids?.slug ?? "Trakt account";
  } catch {
    return "Trakt account";
  }
}

/** Authenticated Trakt request returning parsed JSON (or null on 204). */
export async function traktRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const cred = await requireTrakt();
  const res = await traktAuthedFetch(cred, path, init);
  if (res.status === 401) throw new Error("TRAKT_REAUTH_REQUIRED");
  const text = await res.text();
  if (!res.ok) {
    console.error(`Trakt ${path} failed [${res.status}]: ${text.slice(0, 200)}`);
    throw new Error(`Trakt request failed (${res.status}).`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
