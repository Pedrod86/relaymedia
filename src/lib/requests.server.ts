// Server-only Overseerr / Jellyseerr credential store + API client.
// The API key is sealed with MEDIA_VAULT_SECRET into an httpOnly cookie.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { openJson, sealJson } from "./vault.server";

const COOKIE = "rq_creds";
const MAX_AGE = 60 * 60 * 24 * 365;

export type RequestsCredential = {
  url: string;
  apiKey: string;
  version: string;
  connectedAt: string;
};

export async function readRequests(): Promise<RequestsCredential | null> {
  const raw = getCookie(COOKIE);
  if (!raw) return null;
  return openJson<RequestsCredential>(raw);
}

export async function writeRequests(cred: RequestsCredential | null) {
  setCookie(COOKIE, cred ? await sealJson(cred) : "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cred ? MAX_AGE : 0,
  });
}

export async function seerr<T>(
  cred: { url: string; apiKey: string },
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${cred.url}/api/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-Api-Key": cred.apiKey,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("SEERR_BAD_KEY");
  const text = await res.text();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text);
      if (j?.message) msg = j.message;
    } catch {}
    throw new Error(msg);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("SEERR_NOT_JSON");
  }
}
