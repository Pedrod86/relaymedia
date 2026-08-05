// Server-only TorBox credential store + API client.
//
// The TorBox API token is a bearer credential for the user's whole TorBox
// account, so it is treated exactly like a media-server token: encrypted with
// MEDIA_VAULT_SECRET and kept in an httpOnly cookie that browser JavaScript
// can never read. Only the last 4 characters are ever shown back to the UI.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { openJson, sealJson } from "./vault.server";

export const TORBOX_COOKIE = "tb_creds";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const TORBOX_API_BASE = "https://api.torbox.app/v1/api";

export type TorboxCredential = {
  token: string;
  email: string;
  plan: string;
  connectedAt: string;
};

export type PublicTorbox = {
  connected: true;
  email: string;
  plan: string;
  tokenHint: string;
  connectedAt: string;
};

export function toPublicTorbox(c: TorboxCredential): PublicTorbox {
  return {
    connected: true,
    email: c.email,
    plan: c.plan,
    tokenHint: `••••${c.token.slice(-4)}`,
    connectedAt: c.connectedAt,
  };
}

export async function readTorbox(): Promise<TorboxCredential | null> {
  const raw = getCookie(TORBOX_COOKIE);
  if (!raw) return null;
  return openJson<TorboxCredential>(raw);
}

export async function readTorboxFromRequest(
  request: Request,
): Promise<TorboxCredential | null> {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TORBOX_COOKIE}=`));
  if (!match) return null;
  return openJson<TorboxCredential>(
    decodeURIComponent(match.slice(TORBOX_COOKIE.length + 1)),
  );
}

export async function writeTorbox(cred: TorboxCredential | null) {
  setCookie(TORBOX_COOKIE, cred ? await sealJson(cred) : "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cred ? MAX_AGE_SECONDS : 0,
  });
}

export async function requireTorbox(): Promise<TorboxCredential> {
  const cred = await readTorbox();
  if (!cred) throw new Error("TORBOX_NOT_CONNECTED");
  return cred;
}

/** Authenticated GET against the TorBox API. Returns the parsed `data` field. */
export async function torboxGet<T>(
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${TORBOX_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    // Surface TorBox's own message; it names the real failure (bad token,
    // plan limit, rate limit) far better than a generic 500.
    const detail = body?.detail ?? body?.error ?? text.slice(0, 200);
    console.error(`TorBox ${path} failed [${res.status}]: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new Error("TORBOX_BAD_TOKEN");
    throw new Error(`TorBox request failed (${res.status}): ${detail}`);
  }
  if (body && body.success === false) {
    const detail = body.detail ?? body.error ?? "Unknown TorBox error";
    console.error(`TorBox ${path} returned success:false: ${detail}`);
    throw new Error(String(detail));
  }
  return (body?.data ?? null) as T;
}
