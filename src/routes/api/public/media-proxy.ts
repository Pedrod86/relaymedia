import { createFileRoute } from "@tanstack/react-router";

// Streams media-server content (images, HLS playlists/segments, video, VTT)
// over our own HTTPS origin.
//
// SECURITY: the browser never sends a token here. It passes an opaque server
// id (?sid=) plus an upstream path (?p=). We resolve the server's base URL and
// access token from the encrypted httpOnly cookie vault and attach the
// credential server-side. Because the target host comes from the sealed cookie
// (not from the query string), this endpoint cannot be pointed at an arbitrary
// host — no open proxy / SSRF.

const PASS_REQ_HEADERS = ["range", "accept", "accept-language", "if-range"];
const PASS_RES_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
];

function proxyHref(base: string, sid: string, path: string) {
  return `${base}?sid=${encodeURIComponent(sid)}&p=${encodeURIComponent(path)}`;
}

/** Convert an upstream URI (relative or absolute) to a path on the upstream server. */
function toUpstreamPath(uri: string, sourceUrl: URL): string | null {
  try {
    const abs = new URL(uri, sourceUrl);
    // Only rewrite references that stay on the same upstream origin; anything
    // else would have to be fetched directly and is not proxied.
    if (abs.origin !== sourceUrl.origin) return null;
    return `${abs.pathname}${abs.search}`;
  } catch {
    return null;
  }
}

function rewritePlaylist(text: string, proxyBase: string, sid: string, sourceUrl: URL) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Rewrite URI="..." inside tags (e.g. EXT-X-KEY, EXT-X-MEDIA).
        return line.replace(/URI="([^"]+)"/g, (m, uri) => {
          const path = toUpstreamPath(uri, sourceUrl);
          return path ? `URI="${proxyHref(proxyBase, sid, path)}"` : m;
        });
      }
      const path = toUpstreamPath(trimmed, sourceUrl);
      return path ? proxyHref(proxyBase, sid, path) : line;
    })
    .join("\n");
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const rawPath = url.searchParams.get("p");
  if (!sid || !rawPath) return new Response("missing sid or p", { status: 400 });
  if (!rawPath.startsWith("/")) return new Response("invalid path", { status: 400 });

  const { readVaultFromRequest, normalizeUrl } = await import("@/lib/vault.server");
  const cred = (await readVaultFromRequest(request)).find((c) => c.id === sid);
  if (!cred) return new Response("not authenticated", { status: 401 });

  let targetUrl: URL;
  try {
    // Resolving against the vaulted base pins the host: "p" can only ever
    // address a path on the user's own server.
    targetUrl = new URL(rawPath, `${normalizeUrl(cred.serverUrl)}/`);
    const base = new URL(`${normalizeUrl(cred.serverUrl)}/`);
    if (targetUrl.origin !== base.origin) throw new Error("origin mismatch");
  } catch {
    return new Response("invalid path", { status: 400 });
  }

  const headers = new Headers();
  for (const h of PASS_REQ_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Attach credentials server-side.
  if (cred.kind === "plex") {
    headers.set("X-Plex-Token", cred.token);
    headers.set("X-Plex-Client-Identifier", "lovable-media-web");
  } else {
    headers.set("X-Emby-Token", cred.token);
    headers.set(
      "X-Emby-Authorization",
      `MediaBrowser Client="LovableMedia", Device="Web Browser", DeviceId="lovable-media-web", Version="1.0.0", Token="${cred.token}", UserId="${cred.userId}"`,
    );
    headers.set("Authorization", `MediaBrowser Token="${cred.token}"`);
  }

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow",
  });

  const outHeaders = new Headers();
  for (const h of PASS_RES_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  // Responses are user-specific; never let a shared cache hold them.
  outHeaders.set("cache-control", "private, max-age=0, no-store");

  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isPlaylist =
    ct.includes("mpegurl") ||
    targetUrl.pathname.endsWith(".m3u8") ||
    targetUrl.pathname.endsWith(".m3u");

  if (isPlaylist && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    // Path-only proxy base so the browser resolves segment URLs against the
    // public origin the playlist was fetched from.
    const rewritten = rewritePlaylist(text, url.pathname, sid, targetUrl);
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
