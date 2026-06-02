import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  embyHlsStreamUrl,
  embyDirectStreamUrl,
  plexDirectStreamUrl,
  loadActiveServer,
  type MediaServer,
} from "@/lib/media-client";
import { plexGetStreamInfo, plexGetItem } from "@/lib/plex.functions";
import { embyGetItem } from "@/lib/emby.functions";
import { detectPlaybackSupport, type PlaybackSupport } from "@/lib/playback-support";
import { attachScrobble, type ScrobbleTarget } from "@/lib/trakt-scrobble";

export const Route = createFileRoute("/watch/$id")({
  head: () => ({ meta: [{ title: "Watch — Media" }] }),
  component: WatchPage,
});

function WatchPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [server, setServer] = useState<MediaServer | null>(null);
  useEffect(() => {
    const s = loadActiveServer();
    if (!s) navigate({ to: "/login" });
    else setServer(s);
  }, [navigate]);
  if (!server) {
    return (
      <main className="min-h-screen bg-background p-8 text-muted-foreground">
        Loading…
      </main>
    );
  }
  return <Player server={server} itemId={id} />;
}

type CodecInfo = {
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrateKbps?: number;
  decodedFrames?: number;
  droppedFrames?: number;
};

type TrackOption = { id: number; label: string; active: boolean };

function Player({ server, itemId }: { server: MediaServer; itemId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [mode, setMode] = useState<"hls" | "direct">(server.kind === "plex" ? "direct" : "hls");
  const [error, setError] = useState<string | null>(null);
  const [codec, setCodec] = useState<CodecInfo>({});
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<TrackOption[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [hdrActive, setHdrActive] = useState(false);
  const support = useMemo<PlaybackSupport>(() => detectPlaybackSupport(), []);
  const getPlexStream = useServerFn(plexGetStreamInfo);
  const getEmbyItem = useServerFn(embyGetItem);
  const getPlexItemFn = useServerFn(plexGetItem);
  const [scrobbleTarget, setScrobbleTarget] = useState<ScrobbleTarget | null>(null);

  // Resolve external IDs (IMDb/TMDb) so we can scrobble to Trakt.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (server.kind === "plex") {
          const r = await getPlexItemFn({
            data: { serverUrl: server.serverUrl, token: server.token, itemId },
          });
          if (cancelled || !r?.item) return;
          const guids: string[] = (r.item.Guid ?? []).map((g: any) => g.id ?? "");
          const imdb = guids.find((g) => g.startsWith("imdb://"))?.slice(7);
          const tmdb = guids.find((g) => g.startsWith("tmdb://"))?.slice(7);
          const isEp = r.item.type === "episode";
          setScrobbleTarget({
            type: isEp ? "episode" : "movie",
            imdbId: imdb,
            tmdbId: tmdb ? Number(tmdb) : undefined,
            season: isEp ? r.item.parentIndex : undefined,
            number: isEp ? r.item.index : undefined,
          });
        } else {
          const r = await getEmbyItem({
            data: {
              serverUrl: server.serverUrl,
              token: server.token,
              userId: server.userId,
              itemId,
            },
          });
          if (cancelled || !r?.item) return;
          const ids = r.item.ProviderIds ?? {};
          const isEp = r.item.Type === "Episode";
          setScrobbleTarget({
            type: isEp ? "episode" : "movie",
            imdbId: ids.Imdb,
            tmdbId: ids.Tmdb ? Number(ids.Tmdb) : undefined,
            season: isEp ? r.item.ParentIndexNumber : undefined,
            number: isEp ? r.item.IndexNumber : undefined,
          });
        }
      } catch {
        /* ignore */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [server, itemId, getEmbyItem, getPlexItemFn]);

  // Attach Trakt scrobble once we know what to scrobble.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !scrobbleTarget) return;
    return attachScrobble(video, scrobbleTarget);
  }, [scrobbleTarget]);

  const refreshTrackLists = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls) {
      setAudioTracks([]);
      setSubtitleTracks([]);
      return;
    }
    setAudioTracks(
      hls.audioTracks.map((t, i) => ({
        id: i,
        label: `${t.name ?? t.lang ?? `Track ${i + 1}`}${t.lang ? ` (${t.lang})` : ""}`,
        active: i === hls.audioTrack,
      }))
    );
    setSubtitleTracks([
      { id: -1, label: "Off", active: hls.subtitleTrack === -1 },
      ...hls.subtitleTracks.map((t, i) => ({
        id: i,
        label: `${t.name ?? t.lang ?? `Subs ${i + 1}`}${t.lang ? ` (${t.lang})` : ""}`,
        active: i === hls.subtitleTrack,
      })),
    ]);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setCodec({});
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    function startStatsLoop() {
      if (!video) return;
      interval = setInterval(() => {
        const v = video;
        if (!v) return;
        const quality =
          (v as unknown as { getVideoPlaybackQuality?: () => VideoPlaybackQuality })
            .getVideoPlaybackQuality?.();
        const hls = hlsRef.current;
        const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
        setCodec((prev) => ({
          ...prev,
          width: v.videoWidth || prev.width,
          height: v.videoHeight || prev.height,
          fps: level?.frameRate ?? prev.fps,
          videoCodec: level?.videoCodec ?? prev.videoCodec,
          audioCodec: level?.audioCodec ?? prev.audioCodec,
          bitrateKbps: level?.bitrate ? Math.round(level.bitrate / 1000) : prev.bitrateKbps,
          decodedFrames: quality?.totalVideoFrames ?? prev.decodedFrames,
          droppedFrames: quality?.droppedVideoFrames ?? prev.droppedFrames,
        }));
      }, 1500);
    }

    async function start() {
      if (!video) return;

      // Detect HDR display capability
      if (typeof window !== "undefined" && window.matchMedia) {
        setHdrActive(window.matchMedia("(dynamic-range: high)").matches);
      }

      // ── Plex: direct play only ──
      if (server.kind === "plex") {
        const res = await getPlexStream({
          data: { serverUrl: server.serverUrl, token: server.token, itemId },
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        video.src = plexDirectStreamUrl(server, res.partKey);
        video.play().catch(() => {});
        startStatsLoop();
        return;
      }

      // ── Emby / Jellyfin ──
      if (mode === "direct") {
        video.src = embyDirectStreamUrl(server, itemId);
        video.play().catch(() => {});
        startStatsLoop();
        return;
      }

      const src = embyHlsStreamUrl(server, itemId);

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => {});
        startStatsLoop();
        return;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          refreshTrackLists();
        });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTrackLists);
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, refreshTrackLists);
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshTrackLists);
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, refreshTrackLists);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            console.error("HLS fatal", data);
            setError(`Playback error: ${data.type} / ${data.details}. Trying direct stream…`);
            hls.destroy();
            hlsRef.current = null;
            setMode("direct");
          }
        });
        startStatsLoop();
        return;
      }

      video.src = embyDirectStreamUrl(server, itemId);
      video.play().catch(() => setError("Your browser cannot play this stream."));
      startStatsLoop();
    }

    void start();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [server, itemId, mode, getPlexStream, refreshTrackLists]);

  function switchAudio(id: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.audioTrack = id;
  }
  function switchSubtitle(id: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.subtitleTrack = id;
  }

  const isEmbyFamily = server.kind !== "plex";

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
        <Link to="/item/$id" params={{ id: itemId }} className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {hdrActive && (
            <span className="rounded bg-amber-500/20 px-2 py-1 font-medium text-amber-300">
              HDR display
            </span>
          )}
          {isEmbyFamily && (
            <>
              <button
                onClick={() => setMode("hls")}
                className={`rounded px-2 py-1 ${mode === "hls" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
              >
                HLS
              </button>
              <button
                onClick={() => setMode("direct")}
                className={`rounded px-2 py-1 ${mode === "direct" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
              >
                Direct
              </button>
            </>
          )}
          {audioTracks.length > 1 && (
            <select
              value={audioTracks.find((t) => t.active)?.id ?? 0}
              onChange={(e) => switchAudio(Number(e.target.value))}
              className="rounded bg-white/10 px-2 py-1"
              aria-label="Audio track"
            >
              {audioTracks.map((t) => (
                <option key={t.id} value={t.id} className="bg-black">
                  Audio: {t.label}
                </option>
              ))}
            </select>
          )}
          {subtitleTracks.length > 1 && (
            <select
              value={subtitleTracks.find((t) => t.active)?.id ?? -1}
              onChange={(e) => switchSubtitle(Number(e.target.value))}
              className="rounded bg-white/10 px-2 py-1"
              aria-label="Subtitles"
            >
              {subtitleTracks.map((t) => (
                <option key={t.id} value={t.id} className="bg-black">
                  Subs: {t.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`rounded px-2 py-1 ${showInfo ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
          >
            Info
          </button>
        </div>
      </header>
      <div className="relative flex flex-1 items-center justify-center">
        <video
          ref={videoRef}
          controls
          playsInline
          className="h-full max-h-[88vh] w-full bg-black"
        />
        {showInfo && <InfoOverlay codec={codec} support={support} hdrActive={hdrActive} />}
      </div>
      {error && <p className="px-6 py-2 text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}

function InfoOverlay({
  codec,
  support,
  hdrActive,
}: {
  codec: CodecInfo;
  support: PlaybackSupport;
  hdrActive: boolean;
}) {
  return (
    <div className="absolute right-4 top-4 max-w-xs space-y-2 rounded-lg bg-black/80 p-4 text-xs text-white backdrop-blur">
      <p className="text-sm font-semibold">Playback info</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-white/60">Resolution</dt>
        <dd>{codec.width && codec.height ? `${codec.width}×${codec.height}` : "—"}</dd>
        <dt className="text-white/60">Frame rate</dt>
        <dd>{codec.fps ? `${codec.fps.toFixed(2)} fps` : "—"}</dd>
        <dt className="text-white/60">Video codec</dt>
        <dd className="truncate">{codec.videoCodec ?? "—"}</dd>
        <dt className="text-white/60">Audio codec</dt>
        <dd className="truncate">{codec.audioCodec ?? "—"}</dd>
        <dt className="text-white/60">Bitrate</dt>
        <dd>{codec.bitrateKbps ? `${codec.bitrateKbps} kbps` : "—"}</dd>
        <dt className="text-white/60">Frames</dt>
        <dd>
          {codec.decodedFrames ?? 0} dec / {codec.droppedFrames ?? 0} dropped
        </dd>
        <dt className="text-white/60">HDR display</dt>
        <dd>{hdrActive ? "Yes" : "No"}</dd>
      </dl>
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="font-medium">Browser decoders</p>
        <p className="text-white/70">
          Video: {support.video.join(", ") || "none"}
        </p>
        <p className="text-white/70">
          Audio: {support.audio.join(", ") || "none"}
        </p>
      </div>
    </div>
  );
}
