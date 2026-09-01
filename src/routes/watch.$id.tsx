import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { embySubtitleUrl, streamUrl, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { useProAccess } from "@/lib/use-pro";
import { embyGetItem } from "@/lib/emby.functions";
import { PlaybackDetails } from "@/components/PlaybackDetails";
import {
  allowedCodecs,
  checkItemPlayback,
  loadPlayerPrefs,
  probeCodecs,
  probeHdr,
  savePlayerPrefs,
  wantsHdrPassthrough,
  detectPlaybackEnv,
  NO_HDR,
  WEB_ENV,
  type CodecCap,
  type DecodeMode,
  type HdrMode,
  type HdrSupport,
  type PlayerPrefs,
  type PlaybackEnv,
} from "@/lib/player-prefs";
import {
  scrobbleTargetFromEmbyItem,
  useTraktScrobble,
} from "@/lib/use-trakt-scrobble";
import {
  AFR_OFF,
  measureRefreshRate,
  planFrameRate,
  readFrameStats,
  sourceFrameRate,
  type AfrMode,
  type FrameStats,
} from "@/lib/afr";


export const Route = createFileRoute("/watch/$id")({
  head: () => ({ meta: [{ title: "Watch — Media" }] }),
  component: WatchPage,
});

function WatchPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const { active, isLoading } = useMediaServers();

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <Player key={active.id} server={active} itemId={id} />;
}

type SubTrack = {
  index: number;
  mediaSourceId: string;
  label: string;
  lang?: string;
  isText: boolean;
  isDefault?: boolean;
};

function Player({ server, itemId }: { server: MediaServer; itemId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(loadPlayerPrefs);
  const [caps, setCaps] = useState<CodecCap[]>([]);
  const [hdr, setHdr] = useState<HdrSupport>(NO_HDR);
  // MKV / E-AC3 / HDR10 capability of the surrounding platform (the Android APK
  // plays all three through the device's own decoders).
  const [env, setEnv] = useState<PlaybackEnv>(WEB_ENV);

  const [mode, setMode] = useState<"hls" | "direct" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subIndex, setSubIndex] = useState<number | null>(null); // null = off
  const { isPro } = useProAccess();
  const [showPanel, setShowPanel] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Screen chrome (status chips, subtitle picker, settings) only appears while
  // playback is paused — during playback the picture is left clean, which
  // matters most on a TV.
  const [paused, setPaused] = useState(true);
  const getItemEmby = useServerFn(embyGetItem);

  const isEmbyFamily = server.kind !== "plex";

  const [displayHz, setDisplayHz] = useState<number | undefined>(undefined);
  const [frames, setFrames] = useState<FrameStats | undefined>(undefined);

  useEffect(() => {
    setPrefs(loadPlayerPrefs());
    void probeCodecs().then((c) => {
      setCaps(c);
      void probeHdr(c).then(setHdr);
    });
    setEnv(detectPlaybackEnv());
    void measureRefreshRate().then(setDisplayHz);
  }, []);


  function update(patch: Partial<PlayerPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePlayerPrefs(next);
  }

  // Fetch item to discover subtitle streams + media info (Emby / Jellyfin).
  const itemQ = useQuery({
    enabled: isEmbyFamily,
    queryKey: ["watch-item", server.id, itemId],
    queryFn: () => getItemEmby({ data: { serverId: server.id, itemId } }),
  });

  // Trakt scrobbling: start/pause/stop follow the <video> element.
  const scrobbleTarget = useMemo(
    () => (isEmbyFamily ? scrobbleTargetFromEmbyItem(itemQ.data?.item) : null),
    [itemQ.data, isEmbyFamily],
  );
  useTraktScrobble(videoRef, scrobbleTarget);

  const check = useMemo(
    () =>
      isEmbyFamily && itemQ.data?.item && caps.length
        ? checkItemPlayback(itemQ.data.item, caps, prefs, hdr, env)
        : null,
    [itemQ.data, caps, prefs, isEmbyFamily, hdr, env],
  );

  // HDR request mode: pass the grade through when the display can show it.
  const hdrParam: "passthrough" | "tonemap" = check
    ? check.hdrPassthrough
      ? "passthrough"
      : "tonemap"
    : wantsHdrPassthrough(prefs, hdr)
      ? "passthrough"
      : "tonemap";


  // ── AFR: source cadence, display cadence, and the correction between them ──
  const sourceFps = useMemo(
    () => (isEmbyFamily && itemQ.data?.item ? sourceFrameRate(itemQ.data.item) : undefined),
    [itemQ.data, isEmbyFamily],
  );
  const afr = useMemo(
    () => (isPro ? planFrameRate(prefs.afr, sourceFps, displayHz) : AFR_OFF),
    [prefs.afr, sourceFps, displayHz, isPro],
  );

  // Apply the cadence correction to the element, and keep it applied across
  // seeks / source swaps (browsers reset playbackRate on some src changes).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      if (Math.abs(video.playbackRate - afr.playbackRate) > 0.0005) {
        video.playbackRate = afr.playbackRate;
      }
    };
    apply();
    video.addEventListener("loadedmetadata", apply);
    video.addEventListener("seeked", apply);
    return () => {
      video.removeEventListener("loadedmetadata", apply);
      video.removeEventListener("seeked", apply);
    };
  }, [afr.playbackRate, mode]);

  // Surface dropped frames so cadence problems are visible, not guessed at.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const t = window.setInterval(() => setFrames(readFrameStats(video)), 2000);
    return () => window.clearInterval(t);
  }, [mode]);


  useEffect(() => {
    if (!isEmbyFamily) {
      setMode("direct");
      return;
    }
    if (prefs.playback !== "auto") {
      setMode(prefs.playback);
      return;
    }
    if (check) setMode(check.recommended);
  }, [check, prefs.playback, isEmbyFamily]);

  const subtitles: SubTrack[] = useMemo(() => {
    if (!isEmbyFamily) return [];
    const item: any = itemQ.data?.item;
    const sources: any[] = item?.MediaSources ?? [];
    const out: SubTrack[] = [];
    for (const src of sources) {
      const sid = src.Id ?? itemId;
      for (const st of src.MediaStreams ?? []) {
        if (st.Type !== "Subtitle") continue;
        const isText =
          st.IsTextSubtitleStream ||
          ["srt", "vtt", "ass", "ssa", "sub"].includes((st.Codec || "").toLowerCase());
        out.push({
          index: st.Index,
          mediaSourceId: sid,
          label: st.DisplayTitle || st.Title || st.Language || `Track ${st.Index}`,
          lang: st.Language,
          isText: !!isText,
          isDefault: st.IsDefault,
        });
      }
      if (out.length) break; // first source only
    }
    return out;
  }, [itemQ.data, isEmbyFamily, itemId]);

  const textSubs = useMemo(() => subtitles.filter((s) => s.isText), [subtitles]);

  // Auto-enable the first text subtitle track when requested.
  useEffect(() => {
    if (prefs.autoSubtitles && subIndex === null && textSubs.length > 0) {
      setSubIndex((textSubs.find((s) => s.isDefault) ?? textSubs[0]!).index);
    }
  }, [prefs.autoSubtitles, textSubs, subIndex]);

  const videoCodecs = useMemo(() => allowedCodecs(caps, prefs, "video"), [caps, prefs]);
  const audioCodecs = useMemo(() => {
    const list = allowedCodecs(caps, prefs, "audio");
    // Ask for Dolby Digital / Digital Plus only where the platform can decode
    // it; MSE-based HLS in the browser cannot, so keep it to direct playback.
    if (env.eac3 && mode === "direct" && prefs.decode !== "software")
      return [...new Set([...list, "eac3", "ac3"])];
    return list;
  }, [caps, prefs, env.eac3, mode]);

  // One stable session id per mounted playback, so switching quality/subtitles
  // reuses the same server-side transcode session instead of spawning new ones.
  const sessionId = useMemo(
    () => `lovable-${itemId}-${Math.random().toString(36).slice(2, 10)}`,
    [itemId],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mode) return;
    if (caps.length === 0) return; // wait for codec probing
    setError(null);
    let hlsInstance: Hls | null = null;

    const src = streamUrl(server, itemId, {
      mode,
      videoCodec: videoCodecs,
      audioCodec: audioCodecs,
      maxBitrate: prefs.maxBitrate,
      session: sessionId,
      hdr: hdrParam,
      maxHeight: prefs.maxHeight,
      // AFR: keep the transcode at the source cadence instead of 30/60 fps.
      maxFps: prefs.afr !== "off" ? sourceFps : undefined,
      // MKV stays untouched where the platform can play it; elsewhere the server
      // stream-copies it into MP4 (no re-encode, E-AC3 and HDR10 preserved).
      container: mode === "direct" ? (check?.directContainer ?? "mp4") : undefined,
      remux: mode === "direct" ? check?.remux : undefined,
    });


    if (mode === "direct" || video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native playback: let the browser's own range-based buffering run — it
      // maps directly onto the hardware decoder's demand.
      video.preload = "auto";
      video.src = src;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      // Buffering strategy tuned for smooth hardware-decoded playback:
      //  • ~60s forward buffer capped by size, so the decoder is never starved
      //    but memory stays bounded on mobile GPUs.
      //  • a small back buffer keeps short rewinds instant without holding the
      //    whole session in memory.
      //  • worker + progressive fetch keeps demuxing off the main thread, which
      //    is what causes dropped frames during hardware decode.
      //  • fragment loads are retried and aborted quickly so a stalled segment
      //    doesn't hold the pipeline (server-side the abort cancels upstream).
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        progressive: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        backBufferLength: 30,
        startFragPrefetch: true,
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 5_000_000,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10_000,
            maxLoadTimeMs: 120_000,
            timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4_000 },
          },
        },
      });
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        console.error("HLS fatal", data);
        // Network/media errors are usually recoverable: retry in place before
        // tearing the session down and restarting the transcode.
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hlsInstance?.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== "manifestLoadError") {
          hlsInstance?.startLoad();
          return;
        }
        setError(`Playback error: ${data.type} / ${data.details}. Falling back to direct stream…`);
        hlsInstance?.destroy();
        setMode("direct");
      });
    } else {
      video.src = streamUrl(server, itemId, { mode: "direct", session: sessionId });
      video.play().catch(() => setError("Your browser cannot play this stream."));
    }

    return () => {
      hlsInstance?.destroy();
      // Cancel any in-flight direct-stream request so the server stops
      // transcoding/serving bytes nobody will consume.
      if (!hlsInstance) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [
    server,
    itemId,
    mode,
    caps.length,
    videoCodecs,
    audioCodecs,
    prefs.maxBitrate,
    prefs.maxHeight,
    hdrParam,
    sessionId,
    prefs.afr,
    sourceFps,
    check?.directContainer,
    check?.remux,
  ]);



  // Force the chosen <track> to "showing" — browsers default to "disabled".
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]!;
      const wanted = subIndex !== null && (t as any).__embyIndex === subIndex;
      t.mode = wanted ? "showing" : "disabled";
    }
  }, [subIndex, subtitles]);

  const decodeOptions: { id: DecodeMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "hardware", label: "Hardware" },
    { id: "software", label: "Software" },
  ];

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
        <Link to="/item/$id" params={{ id: itemId }} className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {check && (
            <span
              className={`rounded px-2 py-1 ${
                check.canDirectPlay ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"
              }`}
            >
              {check.canDirectPlay ? "Direct play" : "Transcoding"}
              {check.videoCodec ? ` • ${check.videoCodec.toUpperCase()}` : ""}
              {check.videoSupported ? (check.videoHardware ? " • HW" : " • SW") : ""}
            </span>
          )}
          {check && (check.is4K || check.isHdr) && (
            <span
              className={`rounded px-2 py-1 ${
                check.hdrPassthrough ? "bg-sky-500/20 text-sky-300" : "bg-white/10 text-white/80"
              }`}
            >
              {[
                check.is4K ? "4K" : null,
                check.isDolbyVision ? "Dolby Vision" : check.isHdr ? check.videoRange : null,
                check.isHdr ? (check.hdrPassthrough ? "passthrough" : "tone-mapped") : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </span>
          )}
          {prefs.afr !== "off" && afr.sourceFps && (
            <span
              className={`rounded px-2 py-1 ${
                afr.exact ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"
              }`}
              title={afr.note}
            >
              AFR {Math.round(afr.sourceFps * 1000) / 1000}fps
              {afr.displayHz ? ` → ${afr.displayHz}Hz` : ""}
              {afr.cadence ? ` • ${afr.cadence}:1` : ""}
            </span>
          )}



          {isEmbyFamily && textSubs.length > 0 && (
            <label className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <span className="opacity-70">Subtitles</span>
              <select
                value={subIndex ?? ""}
                onChange={(e) => setSubIndex(e.target.value === "" ? null : Number(e.target.value))}
                className="bg-transparent outline-none [&>option]:bg-black"
              >
                <option value="">Off</option>
                {textSubs.map((s) => (
                  <option key={`${s.mediaSourceId}-${s.index}`} value={s.index}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          >
            ⓘ Playback details
          </button>
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          >
            ⚙ Player settings
          </button>
        </div>
      </header>

      {showDetails && (
        <div className="mx-6 mb-3">
          <PlaybackDetails
            check={check}
            mode={mode ?? null}
            env={env}
            hdrParam={hdrParam}
            videoCodecs={videoCodecs}
            audioCodecs={audioCodecs}
          />
        </div>
      )}

      {showPanel && (
        <div className="mx-6 mb-3 rounded-lg border border-white/10 bg-white/5 p-4 text-xs">
          {!isPro && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
              <span>
                Decoder control, 4K/HDR passthrough and quality caps are part of Relay Pro.
              </span>
              <Link
                to="/upgrade"
                className="rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
              >
                Unlock for $1
              </Link>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {isPro && (
              <div>
                <p className="mb-2 font-medium">Decoding</p>
                <div className="flex gap-1">
                  {decodeOptions.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => update({ decode: o.id })}
                      className={`rounded px-2 py-1 ${
                        prefs.decode === o.id ? "bg-primary text-primary-foreground" : "bg-white/10"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 font-medium">Stream</p>
              <div className="flex gap-1">
                {(["auto", "hls", "direct"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => update({ playback: m })}
                    className={`rounded px-2 py-1 uppercase ${
                      prefs.playback === m ? "bg-primary text-primary-foreground" : "bg-white/10"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {isPro && (
              <>
                <div>
                  <p className="mb-2 font-medium">Quality cap</p>
                  <select
                    value={prefs.maxBitrate}
                    onChange={(e) => update({ maxBitrate: Number(e.target.value) })}
                    className="w-full rounded bg-white/10 px-2 py-1 outline-none [&>option]:bg-black"
                  >
                    {[4, 8, 20, 40, 80, 120].map((mbps) => (
                      <option key={mbps} value={mbps * 1_000_000}>
                        {mbps === 120 ? "Unlimited" : `${mbps} Mbps`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-2 font-medium">HDR / Dolby Vision</p>
                  <div className="flex gap-1">
                    {([
                      { id: "auto", label: "Auto" },
                      { id: "passthrough", label: "Passthrough" },
                      { id: "sdr", label: "Tone-map" },
                    ] as { id: HdrMode; label: string }[]).map((o) => (
                      <button
                        key={o.id}
                        onClick={() => update({ hdr: o.id })}
                        className={`rounded px-2 py-1 ${
                          prefs.hdr === o.id ? "bg-primary text-primary-foreground" : "bg-white/10"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-medium">Max resolution</p>
                  <select
                    value={prefs.maxHeight}
                    onChange={(e) => update({ maxHeight: Number(e.target.value) })}
                    className="w-full rounded bg-white/10 px-2 py-1 outline-none [&>option]:bg-black"
                  >
                    {[720, 1080, 1440, 2160].map((h) => (
                      <option key={h} value={h}>
                        {h === 2160 ? "4K (2160p)" : `${h}p`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-2 font-medium">Auto frame rate (AFR)</p>
                  <div className="flex gap-1">
                    {([
                      { id: "off", label: "Off" },
                      { id: "auto", label: "Auto" },
                      { id: "strict", label: "Strict" },
                    ] as { id: AfrMode; label: string }[]).map((o) => (
                      <button
                        key={o.id}
                        onClick={() => update({ afr: o.id })}
                        className={`rounded px-2 py-1 ${
                          prefs.afr === o.id ? "bg-primary text-primary-foreground" : "bg-white/10"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>


          {check && check.notes.length > 0 && (
            <ul className="mt-3 space-y-1 opacity-70">
              {check.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 opacity-60">
            Detected: {caps.filter((c) => c.supported && c.hardware).map((c) => c.name).join(", ") || "probing…"} (hardware)
          </p>
          <p className="mt-1 opacity-60">
            Display: {hdr.hdrDisplay ? "HDR capable" : "SDR"} • HDR10 {hdr.hdr10 ? "✓" : "✗"} • HLG{" "}
            {hdr.hlg ? "✓" : "✗"} • Dolby Vision {hdr.dolbyVision ? "✓" : "✗"} • 4K hardware{" "}
            {hdr.uhdHardware ? "✓" : "✗"}
          </p>
          <p className="mt-1 opacity-60">
            {afr.note}
            {displayHz ? ` • measured ${displayHz} Hz` : " • measuring refresh rate…"}
            {frames && frames.decoded > 0
              ? ` • ${frames.dropped} dropped / ${frames.decoded} frames`
              : ""}
          </p>


        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <video
          ref={videoRef}
          controls
          playsInline
          crossOrigin="anonymous"
          className="h-full max-h-[88vh] w-full bg-black"
        >
          {textSubs.map((s) => (
            <track
              key={`${s.mediaSourceId}-${s.index}`}
              kind="subtitles"
              srcLang={s.lang || "und"}
              label={s.label}
              src={embySubtitleUrl(server, itemId, s.mediaSourceId, s.index)}
              ref={(el) => {
                if (el) (el.track as any).__embyIndex = s.index;
              }}
            />
          ))}
        </video>
      </div>
      {error && <p className="px-6 py-2 text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}
