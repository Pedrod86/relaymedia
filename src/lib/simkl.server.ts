// Server-only Simkl credential store + API client. The Simkl access token is
// sealed into an httpOnly cookie (same as Trakt); the app's client id stays in
// server env (SIMKL_CLIENT_ID) and is read inside handlers only.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { openJson, sealJson } from "./vault.server";

export const SIMKL_COOKIE = "sk_creds";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const SIMKL_API_BASE = "https://api.simkl.com";

export type SimklCredential = { accessToken: string; username: string; connectedAt: string };

export function simklClientId() {
  const id = process.env["SIMKL_CLIENT_ID"];
  if (!id) throw new Error("SIMKL_NOT_CONFIGURED");
  return id;
}

export async function readSimkl(): Promise<SimklCredential | null> {
  const raw = getCookie(SIMKL_COOKIE);
  if (!raw) return null;
  return openJson<SimklCredential>(raw);
}

export async function writeSimkl(cred: SimklCredential | null) {
  setCookie(SIMKL_COOKIE, cred ? await sealJson(cred) : "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cred ? MAX_AGE_SECONDS : 0,
  });
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "simkl-api-key": simklClientId(),
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** PIN flow step 1: get a short code the user enters at simkl.com/pin. */
export async function requestPin() {
  const id = simklClientId();
  const res = await fetch(`${SIMKL_API_BASE}/oauth/pin?client_id=${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Simkl pin failed [${res.status}]: ${text.slice(0, 200)}`);
    throw new Error(`Simkl refused the pairing request (${res.status}).`);
  }
  return JSON.parse(text) as {
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };
}

/** PIN flow step 2: returns a credential once approved, otherwise null. */
export async function pollPin(userCode: string): Promise<SimklCredential | null> {
  const id = simklClientId();
  const res = await fetch(
    `${SIMKL_API_BASE}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(id)}`,
    { headers: headers() },
  );
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Simkl returned ${res.status}.`);
  if (json?.result !== "OK" || !json?.access_token) return null;
  const username = await fetchUsername(json.access_token);
  return { accessToken: json.access_token, username, connectedAt: new Date().toISOString() };
}

async function fetchUsername(token: string) {
  try {
    const res = await fetch(`${SIMKL_API_BASE}/users/settings`, {
      method: "POST",
      headers: headers(token),
    });
    const j: any = await res.json();
    return String(j?.user?.name ?? j?.account?.id ?? "Simkl account");
  } catch {
    return "Simkl account";
  }
}

export async function simklRequest(path: string, init: RequestInit = {}) {
  const cred = await readSimkl();
  if (!cred) throw new Error("SIMKL_NOT_CONNECTED");
  const res = await fetch(`${SIMKL_API_BASE}${path}`, {
    ...init,
    headers: headers(cred.accessToken),
  });
  if (res.status === 401) throw new Error("SIMKL_REAUTH_REQUIRED");
  const text = await res.text();
  if (!res.ok) {
    console.error(`Simkl ${path} failed [${res.status}]: ${text.slice(0, 200)}`);
    throw new Error(`Simkl request failed (${res.status}).`);
  }
  return text ? JSON.parse(text) : null;
}
