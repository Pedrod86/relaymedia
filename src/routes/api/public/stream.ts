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
// pinned to the user's own server (no open proxy / SSRF).
//
// PERFORMANCE: range requests are forwarded verbatim (206 + Content-Range pass
// straight back, so seeking never re-downloads from byte 0), bodies stream
// without buffering so backpressure reaches the origin, and a client abort
// cancels the upstream fetch. Shared plumbing lives in
// src/lib/stream-proxy.server.ts.

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
  /** Stable per-playback id so the server reuses one transcode session. */
  session: z.string().max(120).optional(),
  /** Seek offset in seconds for a transcoded stream. */
  start: z.coerce.number().min(0).max(1_000_000).optional(),
  /** HDR10 / HLG / Dolby Vision handling. */
  hdr: z.enum(["passthrough", "tonemap"]).default("tonemap"),
  /** Vertical resolution ceiling — 2160 keeps 4K intact. */
  maxHeight: z.coerce.number().int().min(360).max(4320).default(2160),
  /**
   * Frame-rate ceiling. AFR sends the source fps here so the server copies the
   * original cadence instead of converting to a fixed 30/60 fps.
   */
  maxFps: z.coerce.number().min(1).max(300).optional(),
  /**
   * Direct mode: repackage (stream-copy) the source into `container` instead of
   * serving the original file. Lets MKV sources play in players that only
   * understand MP4 while keeping E-AC3 audio and HDR10 video untouched.
   */
  remux: z.coerce.boolean().optional(),

});

const DEVICE_ID = "lovable-media-web";

function proxyHref(sid: string, path: string) {
  return `${MEDIA_PROXY_PATH}?sid=${encodeURIComponent(sid)}&p=${encodeURIComponent(path)}`;
}

function embyPath(q: z.infer<typeof querySchema>, userId: string) {
  const session = q.session || `lovable-${q.item}`;

  if (q.mode === "direct") {
    if (q.remux) {
      // Stream-copy remux: same video + audio bitstreams, new container. Keeps
      // HEVC 10-bit HDR10 and E-AC3 intact — the server only repackages.
      const params = new URLSearchParams({
        UserId: userId,
        DeviceId: DEVICE_ID,
        Static: "false",
        PlaySessionId: session,
        Container: q.container,
        VideoCodec: "copy",
        AudioCodec: "copy",
        AllowVideoStreamCopy: "true",
        AllowAudioStreamCopy: "true",
        CopyTimestamps: "true",
        EnableTonemapping: "false",
        RequireAvc: "false",
      });
      if (q.start) params.set("StartTimeTicks", String(Math.round(q.start * 10_000_000)));
      return `/Videos/${encodeURIComponent(q.item)}/stream.${q.container}?${params}`;
    }
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: DEVICE_ID,
      Static: "true",
      PlaySessionId: session,
    });
    return `/Videos/${encodeURIComponent(q.item)}/stream.${q.container}?${params}`;
  }


  const hdrPass = q.hdr === "passthrough";
  const audioCodecs = q.audioCodec || "aac,mp3";
  // Dolby Digital / Digital Plus is multichannel by nature: when the client can
  // take it, allow up to 5.1/7.1 so the original track is copied, not downmixed.
  const dolbyAudio = /\b(eac3|ec-3|ac3|ac-3)\b/.test(audioCodecs);
  const channels = dolbyAudio ? Math.max(q.audioChannels, 6) : q.audioChannels;

  const params = new URLSearchParams({
    UserId: userId,
    DeviceId: DEVICE_ID,
    PlaySessionId: session,
    VideoCodec: q.videoCodec || "h264,hevc",
    AudioCodec: audioCodecs,
    AudioStreamIndex: "1",
    VideoBitrate: String(q.maxBitrate),
    AudioBitrate: dolbyAudio ? "768000" : "192000",
    MaxAudioChannels: String(channels),
    TranscodingMaxAudioChannels: String(channels),

    SegmentContainer: "ts",
    // Shorter segments = faster first frame and cheaper seeks; the decoder gets
    // a keyframe sooner and hls.js can fill its buffer in parallel.
    SegmentLength: "3",
    MinSegments: "2",
    BreakOnNonKeyFrames: "True",
    // Ask the server to copy the original streams when they already match, so
    // hardware decoding is preserved instead of re-encoding.
    AllowVideoStreamCopy: "true",
    AllowAudioStreamCopy: "true",
    "h264-profile": "high,main,baseline",
    "h264-level": "51",
    // 4K ceiling: keep 2160p intact unless the client asked for less.
    MaxHeight: String(q.maxHeight),
    MaxWidth: String(Math.round((q.maxHeight * 16) / 9)),
    TranscodingMaxHeight: String(q.maxHeight),
    // HEVC Main10 @ L5.1 is the 4K HDR profile; fMP4 segments are required for
    // 10-bit HEVC / Dolby Vision passthrough (MPEG-TS cannot carry DV RPUs).
    "hevc-profile": hdrPass ? "main,main10" : "main",
    "hevc-level": "153",
    "hevc-videobitdepth": hdrPass ? "8,10" : "8",
    "hevc-rangetype": hdrPass ? "SDR,HDR10,HDR10Plus,HLG,DOVI" : "SDR",
    "h264-rangetype": "SDR",
    "h264-videobitdepth": "8",
  });

  // AFR: pin the transcode to the source frame rate so the original cadence
  // (23.976 / 24 / 25 / 50 / 60) survives instead of being converted.
  if (q.maxFps) {
    const fps = String(Math.round(q.maxFps * 1000) / 1000);
    params.set("MaxFramerate", fps);
    params.set("Framerate", fps);
  }

  if (hdrPass) {
    // Preserve the grade: never tone-map, and use fMP4 so 10-bit/DV survives.
    params.set("SegmentContainer", "mp4");
    params.set("EnableTonemapping", "false");
    params.set("RequireAvc", "false");
  } else {
    // Tone-map HDR down to SDR (BT.2390) so colours don't wash out on SDR panels.
    params.set("EnableTonemapping", "true");
    params.set("TonemappingAlgorithm", "bt2390");
    params.set("TonemappingRange", "auto");
    params.set("TonemappingPeak", "100");
    params.set("TonemappingDesat", "0");
  }

  if (q.start) params.set("StartTimeTicks", String(Math.round(q.start * 10_000_000)));
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

  const {
    forwardRequestHeaders,
    fetchUpstream,
    buildResponse,
    classify,
    rewritePlaylist,
  } = await import("@/lib/stream-proxy.server");

  const headers = forwardRequestHeaders(request);

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

  let upstream: Response;
  try {
    upstream = await fetchUpstream(targetUrl.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      signal: request.signal,
    });
  } catch (e: any) {
    // Client went away mid-seek: nothing to send, and the upstream fetch is
    // already cancelled so the server stops producing bytes.
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    return new Response("upstream unreachable", { status: 502 });
  }

  const kind = classify(targetUrl.pathname, upstream.headers.get("content-type") ?? "");

  if (kind === "playlist" && upstream.ok && request.method !== "HEAD") {
    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, targetUrl, (p) => proxyHref(q.sid, p));
    const base = buildResponse(new Response(null, { status: upstream.status }), "playlist", request);
    const outHeaders = new Headers(base.headers);
    outHeaders.set("content-type", "application/vnd.apple.mpegurl");
    outHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    return new Response(`upstream error ${upstream.status}`, { status: upstream.status });
  }

  return buildResponse(upstream, kind, request);
}

export const Route = createFileRoute("/api/public/stream")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
    },
  },
});
