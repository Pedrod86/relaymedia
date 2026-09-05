import { createFileRoute } from "@tanstack/react-router";

// Streams IPTV content (HLS playlists/segments, TS and MP4) over our own
// origin.
//
// SECURITY: the browser only ever passes ?t=<sealed token>. The token is an
// AES-GCM payload minted by our server functions from vaulted credentials, so
// this endpoint cannot be pointed at an arbitrary host by a caller — only URLs
// we sealed ourselves are accepted, and cloud-metadata hosts are rejected.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function handle(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (!token) return new Response("missing t", { status: 400 });

  const { openStreamUrl, sealStreamUrl } = await import("@/lib/iptv.server");
  const target = await openStreamUrl(token);
  if (!target) return new Response("not authenticated", { status: 401 });

  const { forwardRequestHeaders, fetchUpstream, buildResponse, classify } = await import(
    "@/lib/stream-proxy.server"
  );

  const headers = forwardRequestHeaders(request);
  headers.set("user-agent", UA);
  for (const [k, v] of Object.entries(target.headers)) headers.set(k, v);
  headers.delete("cookie");

  let upstream: Response;
  try {
    upstream = await fetchUpstream(target.url, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      signal: request.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    return new Response("upstream unreachable", { status: 502 });
  }

  const sourceUrl = new URL(upstream.url || target.url);
  const kind = classify(sourceUrl.pathname, upstream.headers.get("content-type") ?? "");

  if (kind === "playlist" && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    // Re-seal every child URI so segments and variant playlists keep flowing
    // through this endpoint without exposing provider credentials.
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        out.push(line);
        continue;
      }
      if (trimmed.startsWith("#")) {
        const m = /URI="([^"]+)"/.exec(trimmed);
        if (m?.[1]) {
          const abs = new URL(m[1], sourceUrl).toString();
          out.push(line.replace(m[1], `${url.pathname}?t=${encodeURIComponent(await sealStreamUrl(abs))}`));
        } else {
          out.push(line);
        }
        continue;
      }
      const abs = new URL(trimmed, sourceUrl).toString();
      out.push(`${url.pathname}?t=${encodeURIComponent(await sealStreamUrl(abs))}`);
    }
    const base = buildResponse(new Response(null, { status: upstream.status }), "playlist", request);
    const outHeaders = new Headers(base.headers);
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(out.join("\n"), { status: upstream.status, headers: outHeaders });
  }

  return buildResponse(upstream, kind, request);
}

export const Route = createFileRoute("/api/public/iptv-stream")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
