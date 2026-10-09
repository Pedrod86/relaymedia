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
  /** Audio track index (viewer's language choice). */
  audioIndex: z.coerce.number().int().min(0).max(200).optional(),
  /** Which version (media source) of a multi-version title to play. */
  version: z.coerce.number().int().min(0).max(50).optional(),
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

function proxyHref(sid: string, path: string, vt?: string | null) {
  const base = `${MEDIA_PROXY_PATH}?sid=${encodeURIComponent(sid)}&p=${encodeURIComponent(path)}`;
  return vt ? `${base}&vt=${encodeURIComponent(vt)}` : base;
}

function embyPath(
  q: z.infer<typeof querySchema>,
  userId: string,
  kind: "emby" | "jellyfin",
  opts: { mediaSourceId?: string; minimal?: boolean } = {},
) {
  const session = q.session || `lovable-${q.item}`;
  const jellyfin = kind === "jellyfin";
  // Jellyfin requires MediaSourceId on both /stream and /master.m3u8 (it is
  // optional on Emby). For most library items the media source id equals the
  // item id, but multi-version items differ — PlaybackInfo resolves the real
  // one and passing a wrong id is what makes the server reply 400.
  const mediaSourceId = opts.mediaSourceId || q.item;
  void jellyfin;

  // Minimal fallback: some Emby/Jellyfin builds reject the full profile query
  // (unknown codec-profile keys, framerate pinning, HDR range types). Ask for a
  // plain H.264/AAC HLS ladder that every version accepts.
  if (q.mode === "hls" && opts.minimal) {
    const p = new URLSearchParams({
      UserId: userId,
      DeviceId: DEVICE_ID,
      MediaSourceId: mediaSourceId,
      PlaySessionId: session,
      VideoCodec: "h264",
      AudioCodec: "aac",
      VideoBitrate: String(Math.min(q.maxBitrate, 20_000_000)),
      AudioBitrate: "192000",
      MaxAudioChannels: "2",
      SegmentContainer: "ts",
      MaxHeight: String(q.maxHeight),
    });
    if (q.start) p.set("StartTimeTicks", String(Math.round(q.start * 10_000_000)));
    return `/Videos/${encodeURIComponent(q.item)}/master.m3u8?${p}`;
  }


  if (q.mode === "direct") {
    if (q.remux) {
      // Stream-copy remux: same video + audio bitstreams, new container. Keeps
      // HEVC 10-bit HDR10 and E-AC3 intact — the server only repackages.
      const params = new URLSearchParams({
        UserId: userId,
        DeviceId: DEVICE_ID,
        MediaSourceId: mediaSourceId,
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
      if (q.audioIndex !== undefined) params.set("AudioStreamIndex", String(q.audioIndex));
      if (q.start) params.set("StartTimeTicks", String(Math.round(q.start * 10_000_000)));
      return `/Videos/${encodeURIComponent(q.item)}/stream.${q.container}?${params}`;
    }
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: DEVICE_ID,
      MediaSourceId: mediaSourceId,
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
  // Only go multichannel when the client explicitly asked for it; otherwise
  // downmix to stereo AAC so every device actually produces sound.
  const multi = q.audioChannels > 2;
  const channels = q.audioChannels;

  const params = new URLSearchParams({
    UserId: userId,
    DeviceId: DEVICE_ID,
    MediaSourceId: mediaSourceId,
    PlaySessionId: session,
    VideoCodec: q.videoCodec || "h264,hevc",
    AudioCodec: multi ? audioCodecs : "aac,mp3",
    VideoBitrate: String(q.maxBitrate),

    AudioBitrate: multi && dolbyAudio ? "768000" : "192000",
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

  if (q.audioIndex !== undefined) params.set("AudioStreamIndex", String(q.audioIndex));
  if (q.start) params.set("StartTimeTicks", String(Math.round(q.start * 10_000_000)));
  if (q.subtitleIndex !== undefined) {
    params.set("SubtitleStreamIndex", String(q.subtitleIndex));
    params.set("SubtitleMethod", "Hls");
  }
  return `/Videos/${encodeURIComponent(q.item)}/master.m3u8?${params}`;
}


function handoff(location: string) {
  const r = new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
  (r as any).__handoff = true;
  return r;
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response("invalid request", { status: 400 });
  const q = parsed.data;

  const { credentialForStream, normalizeUrl } = await import("@/lib/vault.server");
  const cred = await credentialForStream(request, q.sid);
  const vt = url.searchParams.get("vt");
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
  let embyBuild: ((minimal: boolean) => string) | undefined;
  if (cred.kind === "plex") {
    // Resolve the media part server-side: Plex needs the concrete Part key.
    const { plexFetch } = await import("@/lib/media.server");
    try {
      const meta = await plexFetch(cred, `/library/metadata/${encodeURIComponent(q.item)}`);
      const part = meta?.MediaContainer?.Metadata?.[0]?.Media?.[q.version ?? 0]?.Part?.[0];
      if (!part?.key) return new Response("no playable part found", { status: 404 });
      path = part.key as string;
      if (q.audioIndex !== undefined) {
        // Same flat ordering as plexStreams() in plex.functions.ts.
        let i = 0;
        let streamId: unknown;
        for (const md of meta?.MediaContainer?.Metadata?.[0]?.Media ?? []) {
          for (const pt of md.Part ?? []) {
            for (const st of pt.Stream ?? []) {
              if (i++ === q.audioIndex && st.streamType === 2) streamId = st.id;
            }
          }
        }
        if (streamId !== undefined && part.id !== undefined) {
          const base = normalizeUrl(cred.serverUrl);
          await fetchUpstream(
            `${base}/library/parts/${encodeURIComponent(String(part.id))}?audioStreamID=${encodeURIComponent(String(streamId))}&allParts=1`,
            { method: "PUT", headers: new Headers({ "X-Plex-Token": cred.token, "X-Plex-Client-Identifier": DEVICE_ID, Accept: "application/json" }) },
          ).then((r) => r.body?.cancel()).catch(() => {});
        }
      }
      if (q.mode === "hls") {
        const tp = new URLSearchParams({
          path: `/library/metadata/${q.item}`,
          mediaIndex: String(q.version ?? 0),
          partIndex: "0",
          protocol: "hls",
          directPlay: "0",
          directStream: "1",
          directStreamAudio: "0",
          fastSeek: "1",
          maxVideoBitrate: String(Math.round(q.maxBitrate / 1000)),
          session: q.session ?? DEVICE_ID,
          "X-Plex-Session-Identifier": q.session ?? DEVICE_ID,
          "X-Plex-Client-Identifier": DEVICE_ID,
          "X-Plex-Product": "Relay Media",
          "X-Plex-Platform": "Chrome",
          "X-Plex-Token": cred.token,
        });
        if (q.start) tp.set("offset", String(Math.floor(q.start)));
        path = `/video/:/transcode/universal/start.m3u8?${tp}`;
      }
    } catch {
      return new Response("failed to resolve stream", { status: 502 });
    }
    headers.set("X-Plex-Token", cred.token);
    headers.set("X-Plex-Client-Identifier", DEVICE_ID);
  } else {
    const kindName = cred.kind === "jellyfin" || cred.kind === "silo" ? "jellyfin" : "emby";
    const auth = `MediaBrowser Client="LovableMedia", Device="Web Browser", DeviceId="${DEVICE_ID}", Version="1.0.0", Token="${cred.token}", UserId="${cred.userId}"`;
    headers.set("X-Emby-Token", cred.token);
    headers.set("X-Emby-Authorization", auth);
    // Jellyfin 10.9+ validates the full MediaBrowser scheme on Authorization; a
    // token-only header is rejected, which showed up as playback failing.
    headers.set("Authorization", auth);

    // Resolve the real media source id (multi-version items don't reuse the
    // item id). A wrong MediaSourceId makes both servers answer 400.
    let mediaSourceId: string | undefined;
    try {
      const base = new URL(`${normalizeUrl(cred.serverUrl)}/`);
      const infoUrl = new URL(
        `/Items/${encodeURIComponent(q.item)}/PlaybackInfo?UserId=${encodeURIComponent(cred.userId)}`,
        base,
      );
      const infoRes = await fetchUpstream(infoUrl.toString(), { method: "GET", headers });
      if (infoRes.ok) {
        const info: any = await infoRes.json();
        const src = info?.MediaSources?.[q.version ?? 0] ?? info?.MediaSources?.[0];
        if (src?.Id) mediaSourceId = String(src.Id);
      } else {
        try { await infoRes.body?.cancel(); } catch { /* ignore */ }
      }
    } catch { /* fall back to the item id */ }

    embyBuild = (minimal: boolean) =>
      embyPath(q, cred.userId, kindName, { mediaSourceId, minimal });
    path = embyBuild(false);
  }



  let targetUrl: URL;
  const resolve = (p: string) => {
    const base = new URL(`${normalizeUrl(cred.serverUrl)}/`);
    const u = new URL(p, base);
    if (u.origin !== base.origin) throw new Error("origin mismatch");
    return u;
  };
  try {
    targetUrl = resolve(path);
  } catch {
    return new Response("invalid stream target", { status: 400 });
  }

  const method = request.method === "HEAD" ? "HEAD" : "GET";
  // Some servers (Silo, debrid-backed libraries) answer a file request with a
  // redirect to a storage/CDN host. Following it blindly forwards the media
  // server's Authorization header to that host (often rejected) and makes the
  // CDN see our server's address, which many block. Follow same-host redirects
  // ourselves; for another host, try once without credentials and otherwise
  // hand the address to the device so it fetches the file itself.
  const doFetch = async (u: string): Promise<Response> => {
    let current = u;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetchUpstream(current, { method, headers, signal: request.signal, redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) return res;
      try { await res.body?.cancel(); } catch { /* ignore */ }
      const next = new URL(loc, current);
      const serverOrigin = new URL(`${normalizeUrl(cred.serverUrl)}/`).origin;
      if (next.origin === serverOrigin) { current = next.toString(); continue; }
      if (next.protocol !== "https:" && next.protocol !== "http:") break;
      // Device player (or explicit hand-off): let the device fetch it directly.
      if (vt || url.searchParams.get("handoff") === "1") return handoff(next.toString());
      const bare = forwardRequestHeaders(request);
      try {
        const ext = await fetchUpstream(next.toString(), { method, headers: bare, signal: request.signal });
        if (ext.ok || ext.status === 206) return ext;
        try { await ext.body?.cancel(); } catch { /* ignore */ }
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
      }
      return handoff(next.toString());
    }
    return new Response("too many redirects", { status: 508 });
  };

  let upstream: Response;
  try {
    upstream = await doFetch(targetUrl.toString());
    // The server rejected our full transcode profile: retry once with a plain
    // H.264/AAC HLS request that every Emby/Jellyfin build accepts, instead of
    // letting hls.js loop on a 400 (the "flashing on/off" symptom).
    if (embyBuild && q.mode === "hls" && !upstream.ok && upstream.status !== 401) {
      try { await upstream.body?.cancel(); } catch { /* ignore */ }
      const retryUrl = resolve(embyBuild(true));
      const retry = await doFetch(retryUrl.toString());
      if (retry.ok) {
        upstream = retry;
        targetUrl = retryUrl;
      } else {
        try { await retry.body?.cancel(); } catch { /* ignore */ }
        upstream = await doFetch(targetUrl.toString());
      }
    }
  } catch (e: any) {
    // Client went away mid-seek: nothing to send, and the upstream fetch is
    // already cancelled so the server stops producing bytes.
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    return new Response("upstream unreachable", { status: 502 });
  }

  if ((upstream as any).__handoff) return upstream;

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
    const detail = await upstream.text().catch(() => "");
    console.error(`[stream] ${cred.kind} ${q.mode} upstream ${upstream.status}:`, detail.slice(0, 300));
    return new Response(`upstream error ${upstream.status}: ${detail.slice(0, 200)}`, { status: upstream.status });
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
