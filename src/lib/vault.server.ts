// Server-only credential vault.
//
// Media-server credentials (Emby/Jellyfin access tokens, Plex X-Plex-Token)
// NEVER touch the browser. They live in an encrypted, httpOnly cookie that
// only this server code can read, so page JavaScript — including any injected
// or third-party script — cannot exfiltrate them.
//
// The cookie payload is AES-GCM encrypted+authenticated with a key derived
// from MEDIA_VAULT_SECRET, which also makes the value tamper-proof (a forged
// cookie can't point the media proxy at an arbitrary host).
import process from "node:process";
import { getCookie, setCookie } from "@tanstack/react-start/server";

export type ServerKind = "emby" | "jellyfin" | "plex" | "silo" | "iptv";

/** Full credential record — server-side only. */
export type MediaCredential = {
  id: string;
  kind: ServerKind;
  name: string;
  serverUrl: string;
  token: string;
  userId: string;
  userName: string;
  /** IPTV only: how the provider was connected. */
  mode?: "xtream" | "m3u";
};

/** The subset that is safe to send to the browser (no token). */
export type PublicMediaServer = Omit<MediaCredential, "token">;

export const COOKIE_NAME = "mv_creds";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const MAX_SERVERS = 12;

export function toPublic(c: MediaCredential): PublicMediaServer {
  const { token: _token, ...rest } = c;
  return rest;
}

export function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function b64urlEncode(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env["MEDIA_VAULT_SECRET"];
  if (!secret) {
    // Fail closed: without a key we will not fall back to storing tokens in
    // a readable form.
    throw new Error("Server misconfigured: MEDIA_VAULT_SECRET is not set.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(creds: MediaCredential[]): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(creds));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

async function open(value: string): Promise<MediaCredential[]> {
  const [version, ivPart, ctPart] = value.split(".");
  if (version !== "v1" || !ivPart || !ctPart) return [];
  try {
    const key = await getKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(ivPart) },
      key,
      b64urlDecode(ctPart),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    return Array.isArray(parsed) ? (parsed as MediaCredential[]) : [];
  } catch {
    // Wrong key, tampered payload, or stale format — treat as signed out.
    return [];
  }
}

/** Read the vault from an explicit Request (used by raw server routes). */
export async function readVaultFromRequest(request: Request): Promise<MediaCredential[]> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return [];
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return [];
  return open(decodeURIComponent(match.slice(COOKIE_NAME.length + 1)));
}

/** Read the vault inside a server function handler. */
export async function readVault(): Promise<MediaCredential[]> {
  const raw = getCookie(COOKIE_NAME);
  return raw ? open(raw) : [];
}

async function writeVault(creds: MediaCredential[]) {
  setCookie(COOKIE_NAME, await seal(creds.slice(0, MAX_SERVERS)), {
    httpOnly: true,
    secure: true,
    // The Lovable preview and installed mobile shell can render the app in an
    // embedded context. A Lax cookie is rejected there, which made login report
    // success and then immediately return an empty server list. Partitioning
    // keeps the credential isolated to the embedding site while allowing it to
    // accompany subsequent same-app server-function and media-proxy requests.
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: creds.length > 0 ? MAX_AGE_SECONDS : 0,
  });
}

export async function addCredential(
  cred: Omit<MediaCredential, "id">,
): Promise<PublicMediaServer> {
  const creds = await readVault();
  const serverUrl = normalizeUrl(cred.serverUrl);
  const id = `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const next: MediaCredential = { ...cred, serverUrl, id };
  // Re-connecting the same server+user replaces the old credential instead of
  // piling up stale tokens.
  const kept = creds.filter(
    (c) => !(c.serverUrl === serverUrl && c.userName === cred.userName),
  );
  kept.push(next);
  await writeVault(kept);
  return toPublic(next);
}

export async function removeCredential(id: string): Promise<PublicMediaServer[]> {
  const creds = (await readVault()).filter((c) => c.id !== id);
  await writeVault(creds);
  return creds.map(toPublic);
}

export async function clearCredentials() {
  await writeVault([]);
}

/**
 * Resolve a credential by id. Throws a generic error when the vault has no
 * such entry (expired cookie or an id the caller made up).
 */
export async function requireCredential(id: string): Promise<MediaCredential> {
  const cred = (await readVault()).find((c) => c.id === id);
  if (!cred) throw new Error("SERVER_SESSION_EXPIRED");
  return cred;
}

/**
 * Generic encrypted-payload helpers, reused by other server-only credential
 * stores (e.g. the TorBox API token) so no second key or format exists.
 */
export async function sealJson(value: unknown): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function openJson<T>(value: string): Promise<T | null> {
  const [version, ivPart, ctPart] = value.split(".");
  if (version !== "v1" || !ivPart || !ctPart) return null;
  try {
    const key = await getKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(ivPart) },
      key,
      b64urlDecode(ctPart),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}
