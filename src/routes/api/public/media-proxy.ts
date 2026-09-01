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
//
// PERFORMANCE: range/conditional headers are forwarded, bodies are streamed
// without buffering (backpressure preserved), client aborts cancel the upstream
// request, and segments/images get a private immutable cache policy. See
// src/lib/stream-proxy.server.ts.

function proxyHref(base: string, sid: string, path: string) {
  return `${base}?sid=${encodeURIComponent(sid)}&p=${encodeURIComponent(path)}`;
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

  const {
    forwardRequestHeaders,
    fetchUpstream,
    buildResponse,
    classify,
    rewritePlaylist,
  } = await import("@/lib/stream-proxy.server");

  const headers = forwardRequestHeaders(request);
  // Attach credentials server-side.
  if (cred.kind === "plex") {
    headers.set("X-Plex-Token", cred.token);
    headers.set("X-Plex-Client-Identifier", "lovable-media-web");
  } else {
    // Jellyfin 10.9+ requires the full MediaBrowser scheme on Authorization
    // (a token-only value is rejected), so send the same string on both headers.
    const auth = `MediaBrowser Client="LovableMedia", Device="Web Browser", DeviceId="lovable-media-web", Version="1.0.0", Token="${cred.token}", UserId="${cred.userId}"`;
    headers.set("X-Emby-Token", cred.token);
    headers.set("X-Emby-Authorization", auth);
    headers.set("Authorization", auth);
  }

  let upstream: Response;
  try {
    upstream = await fetchUpstream(targetUrl.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      signal: request.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    return new Response("upstream unreachable", { status: 502 });
  }

  const kind = classify(targetUrl.pathname, upstream.headers.get("content-type") ?? "");

  if (kind === "playlist" && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    // Path-only proxy base so the browser resolves segment URLs against the
    // public origin the playlist was fetched from.
    const rewritten = rewritePlaylist(text, targetUrl, (p) => proxyHref(url.pathname, sid, p));
    const res = buildResponse(new Response(null, { status: upstream.status }), "playlist", request);
    const outHeaders = new Headers(res.headers);
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }

  return buildResponse(upstream, kind, request);
}

export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
