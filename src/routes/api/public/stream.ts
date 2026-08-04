import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Unified streaming endpoint.
//
// The browser asks for a *logical* stream (server id + item id + mode + codec
// preferences) and this route builds the upstream request server-side:
//   /api/public/stream?sid=<id>&item=<id>&mode=hls|direct
//     &videoCodec=h264,hevc&audioCodec=aac&maxBitrate=20000000
//
// SECURITY: no access token ever reaches the browser. The upstream base URL and
// token come from the encrypted httpOnly cookie vault, so the target host is
// pinned to the user's own server (no open proxy / SSRF). Range requests are
// forwarded so seeking works, and HLS playlists are rewritten so segment URLs
// flow back through our HTTPS origin.

const MEDIA_PROXY_PATH = "/api/public/media-proxy";

const querySchema = z.object({
  sid: z.string().min(1).max(100),
  item: z.string().min(1).max(200),
  mode: z.enum(["hls", "direct"]).default("hls"),
  videoCodec: z.string().max(200).optional(),
  audioCodec: z.string().max(200).optional(),
  maxBitrate: z.coerce.number().int().min(200_000).max(400_000_000).default(20_000_000),
  audioChannels: z.coerce.number().int().min(1).max(8).default(2),
  subtitleIndex: z.coerce.number().int().min(0).max(200).optional(),
  container: z.string().regex(/^[a-z0-9]{2,5}$/).default("mp4"),
});

const PASS_REQ_HEADERS = ["range", "accept", "accept-language", "if-range"];
const PASS_RES_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

const DEVICE_ID = "lovable-media-web";

function proxyHref(sid: string, path: string) {
  return `${MEDIA_PROXY_PATH}?sid=${encodeURIComponent(sid)}&p=${encodeURIComponent(path)}`;
}

function rewritePlaylist(text: string, sid: string, sourceUrl: URL) {
  const toPath = (uri: string) => {
    try {
      const abs = new URL(uri, sourceUrl);
      if (abs.origin !== sourceUrl.origin) return null;
      return `${abs.pathname}${abs.search}`;
    } catch {
      return null;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => {
          const p = toPath(uri);
          return p ? `URI="${proxyHref(sid, p)}"` : m;
        });
      }
      const p = toPath(trimmed);
      return p ? proxyHref(sid, p) : line;
    })
    .join("\n");
}

function embyPath(q: z.infer<typeof querySchema>, userId: string) {
  if (q.mode === "direct") {
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: DEVICE_ID,
      Static: "true",
      PlaySessionId: `lovable-${q.item}`,
    });
    return `/Videos/${encodeURIComponent(q.item)}/stream.${q.container}?${params}`;
  }

  const params = new URLSearchParams({
    UserId: userId,
    DeviceId: DEVICE_ID,
    PlaySessionId: `lovable-${q.item}-${Date.now()}`,
    VideoCodec: q.videoCodec || "h264,hevc",
    AudioCodec: q.audioCodec || "aac,mp3",
    AudioStreamIndex: "1",
    VideoBitrate: String(q.maxBitrate),
    AudioBitrate: "192000",
    MaxAudioChannels: String(q.audioChannels),
    TranscodingMaxAudioChannels: String(q.audioChannels),
    SegmentContainer: "ts",
    MinSegments: "1",
    BreakOnNonKeyFrames: "True",
    "h264-profile": "high,main,baseline",
    "h264-level": "51",
  });
  if (q.subtitleIndex !== undefined) {
    params.set("SubtitleStreamIndex", String(q.subtitleIndex));
    params.set("SubtitleMethod", "Hls");
  }
  return `/Videos/${encodeURIComponent(q.item)}/master.m3u8?${params}`;
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response("invalid request", { status: 400 });
  const q = parsed.data;

  const { readVaultFromRequest, normalizeUrl } = await import("@/lib/vault.server");
  const cred = (await readVaultFromRequest(request)).find((c) => c.id === q.sid);
  if (!cred) return new Response("not authenticated", { status: 401 });

  const headers = new Headers();
  for (const h of PASS_REQ_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  let path: string;
  if (cred.kind === "plex") {
    // Resolve the media part server-side: Plex needs the concrete Part key.
    const { plexFetch } = await import("@/lib/media.server");
    try {
      const meta = await plexFetch(cred, `/library/metadata/${encodeURIComponent(q.item)}`);
      const part = meta?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0];
      if (!part?.key) return new Response("no playable part found", { status: 404 });
      path = part.key as string;
    } catch {
      return new Response("failed to resolve stream", { status: 502 });
    }
    headers.set("X-Plex-Token", cred.token);
    headers.set("X-Plex-Client-Identifier", DEVICE_ID);
  } else {
    path = embyPath(q, cred.userId);
    headers.set("X-Emby-Token", cred.token);
    headers.set(
      "X-Emby-Authorization",
      `MediaBrowser Client="LovableMedia", Device="Web Browser", DeviceId="${DEVICE_ID}", Version="1.0.0", Token="${cred.token}", UserId="${cred.userId}"`,
    );
    headers.set("Authorization", `MediaBrowser Token="${cred.token}"`);
  }

  let targetUrl: URL;
  try {
    const base = new URL(`${normalizeUrl(cred.serverUrl)}/`);
    targetUrl = new URL(path, base);
    if (targetUrl.origin !== base.origin) throw new Error("origin mismatch");
  } catch {
    return new Response("invalid stream target", { status: 400 });
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
  outHeaders.set("cache-control", "private, max-age=0, no-store");

  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isPlaylist = ct.includes("mpegurl") || targetUrl.pathname.endsWith(".m3u8");

  if (isPlaylist && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(rewritePlaylist(text, q.sid, targetUrl), {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  if (!upstream.ok) {
    return new Response(`upstream error ${upstream.status}`, { status: upstream.status });
  }

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/public/stream")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
