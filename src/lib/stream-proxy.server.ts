// Shared streaming plumbing for the media proxy and the /api/public/stream
// endpoint.
//
// Goals:
//  • Range requests: forward conditional/range headers untouched and pass 206 +
//    Content-Range/Accept-Ranges straight back so the browser can seek and the
//    decoder can start mid-file.
//  • Backpressure: never buffer a media body in memory. We hand the upstream
//    ReadableStream to the platform, which only pulls from the origin as fast as
//    the client drains it.
//  • Cancellation: wire the client's AbortSignal to the upstream fetch so an
//    aborted fragment (seek, quality switch, tab close) immediately releases the
//    upstream connection instead of downloading into the void.
//  • Caching: segments and images are content-addressed and safely cacheable in
//    the *private* browser cache; playlists and manifests never are.

// NOTE: `accept-encoding` is deliberately NOT forwarded. The server runtime
// transparently decompresses upstream bodies, so echoing the upstream
// `content-encoding` (and its compressed `content-length`) back to the browser
// makes it try to gunzip plain bytes — images and playlists then fail to
// decode. Asking upstream for identity keeps byte ranges honest too.
export const PASS_REQ_HEADERS = [
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
  "accept",
  "accept-language",
];

export const PASS_RES_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

/** Copy through the request headers that matter for ranges and revalidation. */
export function forwardRequestHeaders(request: Request, into = new Headers()) {
  for (const h of PASS_REQ_HEADERS) {
    const v = request.headers.get(h);
    if (v) into.set(h, v);
  }
  return into;
}

/**
 * Fetch upstream with the client's abort signal attached and a connect timeout
 * that does not apply to the body stream (media bodies are long-lived).
 */
export async function fetchUpstream(
  target: string,
  init: { method: string; headers: Headers; signal?: AbortSignal | null },
  connectTimeoutMs = 15_000,
) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), connectTimeoutMs);
  try {
    const res = await fetch(target, {
      method: init.method,
      headers: init.headers,
      redirect: "follow",
      signal: controller.signal,
    });
    // Headers are in: the body may keep streaming well past the timeout.
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

export type BodyKind = "playlist" | "segment" | "image" | "video" | "other";

export function classify(pathname: string, contentType: string): BodyKind {
  const ct = contentType.toLowerCase();
  const p = pathname.toLowerCase();
  if (ct.includes("mpegurl") || p.endsWith(".m3u8") || p.endsWith(".m3u")) return "playlist";
  if (p.endsWith(".ts") || p.endsWith(".m4s") || p.endsWith(".aac") || ct.includes("mp2t")) return "segment";
  if (ct.startsWith("image/") || p.includes("/images/") || p.includes("/photo/")) return "image";
  if (ct.startsWith("video/") || p.includes("/stream")) return "video";
  return "other";
}

/**
 * Build the outbound response: pass range/validator headers through, guarantee
 * byte-range support is advertised for media, and apply a private cache policy
 * suited to the body kind.
 */
export function buildResponse(upstream: Response, kind: BodyKind, request: Request) {
  const headers = new Headers();
  for (const h of PASS_RES_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  // Seeking needs byte ranges. Emby/Jellyfin static files support them but do
  // not always advertise it on a plain 200.
  if ((kind === "video" || kind === "segment") && !headers.has("accept-ranges")) {
    headers.set("accept-ranges", "bytes");
  }

  switch (kind) {
    case "playlist":
      // Live-updating manifests during transcode: must always be revalidated.
      headers.set("cache-control", "private, no-store");
      break;
    case "segment":
      // Immutable once produced; letting the browser keep them makes seeking
      // back and small buffer flushes free.
      headers.set("cache-control", "private, max-age=3600, immutable");
      break;
    case "image":
      headers.set("cache-control", "private, max-age=604800, immutable");
      break;
    default:
      headers.set("cache-control", "private, no-store");
  }

  headers.set("x-content-type-options", "nosniff");
  // Never let a shared/CDN cache hold user media.
  headers.append("vary", "range");

  if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers });
  }

  // Streaming pass-through: no buffering, backpressure handled by the platform.
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Turn an upstream URI (relative or absolute) into a same-origin path. */
export function toUpstreamPath(uri: string, sourceUrl: URL): string | null {
  try {
    const abs = new URL(uri, sourceUrl);
    if (abs.origin !== sourceUrl.origin) return null;
    return `${abs.pathname}${abs.search}`;
  } catch {
    return null;
  }
}

/** Rewrite every same-origin URI in an HLS playlist through `hrefFor`. */
export function rewritePlaylist(
  text: string,
  sourceUrl: URL,
  hrefFor: (path: string) => string,
) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => {
          const p = toUpstreamPath(uri, sourceUrl);
          return p ? `URI="${hrefFor(p)}"` : m;
        });
      }
      const p = toUpstreamPath(trimmed, sourceUrl);
      return p ? hrefFor(p) : line;
    })
    .join("\n");
}
