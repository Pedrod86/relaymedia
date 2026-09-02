// Shared handler behind the public playback URL (e.g.
// https://proxy.relay-media.store/play?...). It is a thin, CORS-enabled façade
// over /api/public/stream so external players (Media3/ExoPlayer, VLC, cast
// receivers) can be handed a single stable URL.
//
// SECURITY: no credentials are accepted from the query string. The request's
// own cookies (the encrypted httpOnly vault) are forwarded to the internal
// stream endpoint, which pins the upstream host to the user's own server.

const STREAM_PATH = "/api/public/stream";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "range, if-range, if-none-match, if-modified-since, accept",
  "access-control-expose-headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "access-control-max-age": "86400",
};

export function playPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handlePlay(request: Request) {
  const url = new URL(request.url);
  const target = new URL(STREAM_PATH + url.search, url.origin);

  const headers = new Headers();
  for (const h of ["range", "if-range", "if-none-match", "if-modified-since", "accept", "accept-language", "cookie"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow",
      signal: request.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    return new Response("stream unavailable", { status: 502, headers: CORS_HEADERS });
  }

  const out = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.set(k, v);

  if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
