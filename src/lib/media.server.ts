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

// Cloud/link-local metadata endpoints reachable from the hosting infrastructure.
// User LAN servers stay allowed; only these well-known SSRF targets are blocked.
const BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "100.100.100.200",
]);

/** Throws if the URL targets a known cloud metadata endpoint. */
export function assertSafeServerUrl(url: string) {
  let host: string;
  let protocol: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    protocol = u.protocol;
  } catch {
    throw new Error("Invalid server URL.");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only http and https server URLs are supported.");
  }
  if (BLOCKED_HOSTS.has(host) || host.startsWith("169.254.") || host === "fd00:ec2::254") {
    throw new Error("This address is not allowed.");
  }
}

/** True when the host is a bare IPv4/IPv6 literal rather than a DNS name. */
export function isBareIpHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  } catch {
    return false;
  }
}

export const DIRECT_IP_ERROR =
  "The hosting network blocks connections made to a bare IP address. Use a domain name for your server (e.g. https://media.yourdomain.com:42420 or a free DDNS hostname) and try again.";

/**
 * The published app runs behind a network that refuses outbound requests to raw
 * IP addresses (it answers with "error code: 1003"). Translate that into advice
 * instead of a bare HTTP status.
 */
export function upstreamBlockMessage(
  status: number,
  body: string,
  serverUrl: string,
): string | null {
  const blocked = /error code:\s*1003|direct ip access/i.test(body);
  if (blocked || (status === 403 && isBareIpHost(serverUrl))) return DIRECT_IP_ERROR;
  return null;
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
