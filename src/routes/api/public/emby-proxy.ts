import { createFileRoute } from "@tanstack/react-router";
import { assertSafeExternalUrl } from "@/lib/ssrf-guard";

// Streams Emby HTTP content over our HTTPS origin so the browser will load
// images / HLS / direct video from a non-HTTPS Emby server without
// mixed-content blocks. Caller passes the full target URL (already includes
// api_key) as ?u=<encoded>.
//
// For .m3u8 playlists we rewrite absolute http(s) URIs so segment requests
// also flow through the proxy.

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

function proxyHref(base: string, target: string) {
  return `${base}?u=${encodeURIComponent(target)}`;
}

function rewritePlaylist(text: string, proxyBase: string, sourceUrl: URL) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        // Rewrite URI="..." inside tags (e.g. EXT-X-KEY, EXT-X-MEDIA).
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          const abs = new URL(uri, sourceUrl).toString();
          return `URI="${proxyHref(proxyBase, abs)}"`;
        });
      }
      const abs = new URL(trimmed, sourceUrl).toString();
      return proxyHref(proxyBase, abs);
    })
    .join("\n");
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("u");
  if (!target) return new Response("missing u", { status: 400 });

  let targetUrl: URL;
  try {
    targetUrl = await assertSafeExternalUrl(target);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid url";
    return new Response(msg, { status: 400 });
  }

  const headers = new Headers();
  for (const h of PASS_REQ_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual",
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    return new Response("upstream fetch failed", { status: 502 });
  }
  clearTimeout(timeout);

  // Don't blindly follow redirects — they could escape into private IP space.
  if (upstream.status >= 300 && upstream.status < 400) {
    return new Response("upstream redirected", { status: 502 });
  }

  const outHeaders = new Headers();
  for (const h of PASS_RES_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  outHeaders.set("Access-Control-Allow-Origin", "*");

  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isPlaylist =
    ct.includes("mpegurl") ||
    targetUrl.pathname.endsWith(".m3u8") ||
    targetUrl.pathname.endsWith(".m3u");

  // Restrict proxied content to media-ish types so the proxy can't be abused
  // to fetch arbitrary HTML/JSON from third-party origins.
  const allowedPrefixes = ["image/", "video/", "audio/", "font/"];
  const allowedExact = new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "application/octet-stream",
    "application/dash+xml",
    "application/mp4",
    "text/vtt",
  ]);
  const ctBase = ct.split(";")[0].trim();
  const ctAllowed =
    !ctBase ||
    isPlaylist ||
    allowedExact.has(ctBase) ||
    allowedPrefixes.some((p) => ctBase.startsWith(p));
  if (!ctAllowed) {
    return new Response("content-type not allowed", { status: 415 });
  }

  if (isPlaylist && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    // Path-only proxy base so the browser resolves segment URLs against the
    // public origin the playlist was fetched from (avoids leaking the
    // internal worker host like https://localhost:8080).
    const proxyBase = url.pathname;
    const rewritten = rewritePlaylist(text, proxyBase, targetUrl);
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }


  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/public/emby-proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Range, Accept",
            "Access-Control-Max-Age": "86400",
          },
        }),
    },
  },
});
