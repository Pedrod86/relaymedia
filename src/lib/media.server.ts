// Server-only HTTP helpers for talking to media servers with vaulted
// credentials. Never imported by client code (blocked by the .server suffix).
import type { MediaCredential } from "./vault.server";

const CLIENT_NAME = "LovableMedia";
const DEVICE_NAME = "Web Browser";
const APP_VERSION = "1.0.0";
export const DEVICE_ID = "lovable-media-web";

const PLEX_PRODUCT = "LovableMedia";
const PLEX_VERSION = "1.0.0";
const PLEX_PLATFORM = "Web";
const PLEX_DEVICE_NAME = "Browser";

export function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function embyAuthHeader(token?: string, userId?: string) {
  const parts = [
    `MediaBrowser Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${DEVICE_ID}"`,
    `Version="${APP_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  if (userId) parts.push(`UserId="${userId}"`);
  return parts.join(", ");
}

export async function embyFetch(c: MediaCredential, path: string) {
  const res = await fetch(`${normalizeUrl(c.serverUrl)}${path}`, {
    headers: {
      "X-Emby-Authorization": embyAuthHeader(c.token, c.userId),
      Authorization: embyAuthHeader(c.token, c.userId),
      "X-Emby-Token": c.token,
    },
  });
  if (!res.ok) {
    throw new Error(`Server request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function plexHeaders(token?: string) {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": DEVICE_ID,
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Platform": PLEX_PLATFORM,
    "X-Plex-Device": PLEX_PLATFORM,
    "X-Plex-Device-Name": PLEX_DEVICE_NAME,
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

/** Plex request with the token sent as a header only — never in the URL. */
export async function plexRequest(serverUrl: string, path: string, token: string) {
  const res = await fetch(`${normalizeUrl(serverUrl)}${path}`, { headers: plexHeaders(token) });
  if (!res.ok) throw new Error(`Plex request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<any>;
}

export function plexFetch(c: MediaCredential, path: string) {
  return plexRequest(c.serverUrl, path, c.token);
}
