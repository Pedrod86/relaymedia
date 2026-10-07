import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { embySubtitleUrl, streamUrl, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { embyGetItem, embyGetItems } from "@/lib/emby.functions";
import { plexGetItem } from "@/lib/plex.functions";
import { PlaybackDetails } from "@/components/PlaybackDetails";
import { useAudioFx } from "@/lib/use-audio-fx";
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
import { useHistoryRecorder } from "@/lib/use-watch-history";
import { media3Available, media3Play } from "@/lib/native-player";
import { isTvDevice } from "@/lib/platform";
import {
  AFR_OFF,
  measureRefreshRate,
  planFrameRate,
  readFrameStats,
  sourceFrameRate,
  type AfrMode,
  type FrameStats,
} from "@/lib/afr";


const LANGS: Record<string, string> = { eng: "English", en: "English", fre: "French", fra: "French", fr: "French", ger: "German", deu: "German", de: "German", spa: "Spanish", es: "Spanish", ita: "Italian", it: "Italian", jpn: "Japanese", ja: "Japanese", kor: "Korean", ko: "Korean", chi: "Chinese", zho: "Chinese", zh: "Chinese", por: "Portuguese", pt: "Portuguese", rus: "Russian", ru: "Russian", hin: "Hindi", hi: "Hindi", ara: "Arabic", ar: "Arabic", dut: "Dutch", nld: "Dutch", nl: "Dutch", pol: "Polish", pl: "Polish", tur: "Turkish", tr: "Turkish", swe: "Swedish", sv: "Swedish", nor: "Norwegian", dan: "Danish", fin: "Finnish" };

function isDescriptive(st: any): boolean {
  const t = `${st.Title ?? ""} ${st.DisplayTitle ?? ""}`.toLowerCase();
  return !!st.IsHearingImpaired || /audio description|described|descriptive|visually impaired|\(ad\)|\[ad\]|\bad\b/.test(t);
}

function audioLabel(st: any): string {
  const code = String(st.Language ?? "").toLowerCase();
  const lang = LANGS[code] ?? (code ? code.toUpperCase() : "Unknown");
  const ch = st.Channels ? (st.Channels >= 8 ? "7.1" : st.Channels >= 6 ? "5.1" : st.Channels === 1 ? "Mono" : "Stereo") : "";
  const raw = String(st.Codec ?? "").toUpperCase();
  const codec = raw === "EAC3" ? "Dolby Digital+" : raw === "AC3" ? "Dolby Digital" : raw === "TRUEHD" ? "TrueHD" : raw;
  const title = st.Title && !/^(stereo|surround|mono|5\.1|7\.1)$/i.test(st.Title) ? ` – ${st.Title}` : "";
  const ad = isDescriptive(st) && !/descri/i.test(title) ? " (Audio description)" : "";
  return [lang, ch, codec].filter(Boolean).join(" · ") + title + ad;
}

export const Route = createFileRoute("/watch/$id")({
  head: () => ({
    meta: [
      { title: "Now Playing — Relay Media" },
      { name: "description", content: "Watch this title from your media server with subtitles, audio tracks and hardware decoding." },
    ],
  }),
  // `audio` carries the language chosen on the title page into playback.
  validateSearch: (search: Record<string, unknown>): { audio?: number; v?: number } => {
    const out: { audio?: number; v?: number } = {};
    const n = Number(search.audio);
    if (search.audio != null && Number.isFinite(n)) out.audio = n;
    const v = Number(search.v);
    if (search.v != null && Number.isInteger(v) && v >= 0) out.v = v;
    return out;
  },
  component: WatchPage,
});

function WatchPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const { audio, v } = Route.useSearch();
  const { active, isLoading } = useMediaServers();

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <Player key={active.id} server={active} itemId={id} initialAudioIndex={audio} version={v} />;
}

type SubTrack = {
  index: number;
  mediaSourceId: string;
  label: string;
  lang?: string;
  isText: boolean;
  isDefault?: boolean;
};

function Player({
  server,
  itemId,
  initialAudioIndex,
  version = 0,
}: {
  server: MediaServer;
  itemId: string;
  initialAudioIndex?: number;
  version?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(loadPlayerPrefs);
  const [caps, setCaps] = useState<CodecCap[]>([]);
  const [hdr, setHdr] = useState<HdrSupport>(NO_HDR);
  // MKV / E-AC3 / HDR10 capability of the surrounding platform (the Android APK
  // plays all three through the device's own decoders).
  const [env, setEnv] = useState<PlaybackEnv>(WEB_ENV);
  // TV mode hides the pause overlay so the paused picture stays clean on a big screen.
  const [isTv, setIsTv] = useState(false);

  const [mode, setMode] = useState<"hls" | "direct" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subIndex, setSubIndex] = useState<number | null>(null); // null = off
  // Audio language: null = the server's default track.
  const [audioIndex, setAudioIndex] = useState<number | null>(initialAudioIndex ?? null);
  const [showPanel, setShowPanel] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Screen chrome (status chips, subtitle picker, settings) only appears while
  // playback is paused on a phone/tablet/desktop — on a TV the paused picture is
  // left completely clean, which is what big-screen viewers expect.
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
    setIsTv(isTvDevice());
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
  // Plex: only used for its audio track list.
  const getItemPlex = useServerFn(plexGetItem);
  const plexItemQ = useQuery({
    enabled: !isEmbyFamily,
    queryKey: ["watch-plex-item", server.id, itemId],
    queryFn: () => getItemPlex({ data: { serverId: server.id, itemId } }),
  });

  // Trakt scrobbling: start/pause/stop follow the <video> element.
  const scrobbleTarget = useMemo(
    () => (isEmbyFamily ? scrobbleTargetFromEmbyItem(itemQ.data?.item) : null),
    [itemQ.data, isEmbyFamily],
  );
  useTraktScrobble(videoRef, scrobbleTarget);

  // Personal watch history (kept on this device) — powers the history row and
  // the suggestions on the homepage.
  useHistoryRecorder(videoRef, server.id, itemQ.data?.item);

  // ---- Next episode (series autoplay) --------------------------------------
  const navigate = useNavigate();
  const getItemsEmby = useServerFn(embyGetItems);
  const watched = itemQ.data?.item as any;
  const seriesId: string | undefined =
    watched?.Type === "Episode" ? (watched?.SeriesId as string | undefined) : undefined;

  const episodesQ = useQuery({
    enabled: isEmbyFamily && !!seriesId,
    queryKey: ["series-episodes", server.id, seriesId],
    queryFn: () =>
      getItemsEmby({
        data: {
          serverId: server.id,
          parentId: seriesId!,
          recursive: true,
          includeItemTypes: "Episode",
          limit: 200,
          sortBy: "ParentIndexNumber,IndexNumber,SortName",
        },
      }),
  });

  const nextEpisode = useMemo(() => {
    const list: any[] = episodesQ.data?.items ?? [];
    const i = list.findIndex((e) => String(e?.Id) === String(itemId));
    return i >= 0 ? (list[i + 1] ?? null) : null;
  }, [episodesQ.data, itemId]);

  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  // When the episode finishes, roll into the following one automatically.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnded = () => {
      if (sleepAfterRef.current) return; // sleep timer: stop after this episode
      if (nextEpisode?.Id) setNextCountdown(8);
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [nextEpisode, mode]);

  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      const id = nextEpisode?.Id;
      setNextCountdown(null);
      if (id) navigate({ to: "/watch/$id", params: { id: String(id) } });
      return;
    }
    const t = setTimeout(() => setNextCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [nextCountdown, nextEpisode, navigate]);

  const nextEpisodeLabel = nextEpisode
    ? [
        nextEpisode.ParentIndexNumber != null && nextEpisode.IndexNumber != null
          ? `S${nextEpisode.ParentIndexNumber}·E${nextEpisode.IndexNumber}`
          : nextEpisode.IndexNumber != null
            ? `Episode ${nextEpisode.IndexNumber}`
            : null,
        nextEpisode.Name,
      ]
        .filter(Boolean)
        .join(" — ")
    : "";

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
    () => planFrameRate(prefs.afr, sourceFps, displayHz),
    [prefs.afr, sourceFps, displayHz],
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
    const all: any[] = item?.MediaSources ?? [];
    const sources: any[] = all[version] ? [all[version], ...all.filter((_, i) => i !== version)] : all;
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

  // Audio tracks (languages) offered by the first media source.
  const audioTracks = useMemo(() => {
    const item: any = isEmbyFamily ? itemQ.data?.item : plexItemQ.data?.item;
    const src: any = isEmbyFamily
      ? (item?.MediaSources ?? [])[version] ?? (item?.MediaSources ?? [])[0]
      : undefined;
    const streams: any[] = src?.MediaStreams ?? item?.MediaStreams ?? [];
    return streams
      .filter((st) => st.Type === "Audio")
      .map((st) => ({
        lang: String(st.Language ?? "").toLowerCase(),
        index: st.Index as number,
        label: audioLabel(st),
        isDefault: !!st.IsDefault,
        descriptive: isDescriptive(st),
      }));
  }, [itemQ.data, plexItemQ.data, isEmbyFamily, version]);

  // Preferred audio language from Settings, when the viewer didn't pick one.
  const langApplied = useRef(false);
  useEffect(() => {
    if (langApplied.current || audioIndex !== null || !prefs.audioLanguage || !audioTracks.length) return;
    langApplied.current = true;
    const want = prefs.audioLanguage.toLowerCase();
    const hit = audioTracks.find((a: any) => !a.descriptive && (a.lang === want || a.lang.startsWith(want.slice(0, 2))));
    if (hit && !hit.isDefault) setAudioIndex(hit.index);
  }, [audioTracks, prefs.audioLanguage, audioIndex]);

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
    if (prefs.audioPassthrough && prefs.decode !== "software" && (env.eac3 || mode === "direct"))
      return [...new Set([...list, "eac3", "ac3", "dts", "truehd"])];
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

    // Plex serves the original file in direct mode, which can't switch audio
    // tracks — a chosen track goes through Plex's transcoder instead.
    const effMode = !isEmbyFamily && audioIndex !== null ? "hls" : mode;
    const src = streamUrl(server, itemId, {
      mode: effMode,
      videoCodec: videoCodecs,
      audioCodec: audioCodecs,
      maxBitrate: prefs.maxBitrate,
      audioIndex: audioIndex ?? undefined,
      // Multichannel tracks often decode silently in the built-in player, so
      // only ask for 5.1/7.1 when passthrough to a receiver is switched on.
      audioChannels: prefs.audioPassthrough ? prefs.audioChannels : 2,
      version,
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


    // Android (phone/TV WebView and Chrome) answers "maybe" for
    // application/vnd.apple.mpegurl but cannot actually demux HLS — trusting it
    // is what made playback load and then break on Android TV. Only Apple
    // platforms get native HLS; everywhere else hls.js wins when supported.
    const nativeHls =
      !Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (effMode === "direct" || nativeHls) {
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

    // A failed element-level load (unsupported container/codec on this device)
    // otherwise shows only a broken-video icon. Report it, and when a direct
    // stream fails, retry through HLS so the server transcodes instead.
    const onVideoError = () => {
      const code = video.error?.code;
      if (mode === "direct" && !hlsInstance) {
        setError("This file couldn't play directly on this device — switching to a transcoded stream…");
        setMode("hls");
        return;
      }
      setError(`Playback failed on this device${code ? ` (media error ${code})` : ""}.`);
    };
    video.addEventListener("error", onVideoError);

    return () => {
      video.removeEventListener("error", onVideoError);
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
    audioIndex,
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

  // Track play/pause so the overlay chrome can hide itself during playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setPaused(video.paused || video.ended);
    sync();
    video.addEventListener("play", sync);
    video.addEventListener("playing", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("playing", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
    };
  }, [mode]);

  // ---- Playback position, volume, speed ------------------------------------
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [soundOpen, setSoundOpen] = useState(false);
  const audioFx = useAudioFx(videoRef, [mode]);
  const { fx, update: updateFx } = audioFx;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPosition(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
    };
    sync();
    video.addEventListener("timeupdate", sync);
    video.addEventListener("durationchange", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("volumechange", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("durationchange", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("volumechange", sync);
    };
  }, [mode]);

  // ---- End time, sleep timer, intro/credits skip ---------------------------
  const endsAt = useMemo(() => {
    if (!duration || duration <= 0) return null;
    const remaining = (duration - position) / (speed || 1);
    return new Date(Date.now() + remaining * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(position / 30), duration, speed]);

  const [sleepLeft, setSleepLeft] = useState<number | null>(null);
  const [sleepAfterEpisode, setSleepAfterEpisode] = useState(false);
  const sleepAfterRef = useRef(false);
  sleepAfterRef.current = sleepAfterEpisode;

  useEffect(() => {
    if (sleepLeft === null) return;
    if (sleepLeft <= 0) {
      videoRef.current?.pause();
      setSleepLeft(null);
      return;
    }
    const t = setTimeout(() => {
      if (!videoRef.current?.paused) setSleepLeft((s) => (s === null ? null : s - 1));
      else setSleepLeft((s) => s);
    }, 1000);
    return () => clearTimeout(t);
  }, [sleepLeft]);

  const skipMarkers: { kind: "intro" | "credits"; start: number; end: number }[] =
    ((itemQ.data?.item as any)?.SkipMarkers ?? []).filter((m: any) => m && m.end > m.start);
  const activeSkipRaw = skipMarkers.find((m) => position >= m.start && position < m.end - 1) ?? null;
  const activeSkip = prefs.introSkip === "never" ? null : activeSkipRaw;
  const autoSkippedRef = useRef<Set<number>>(new Set());
  const [undoSkip, setUndoSkip] = useState<{ from: number } | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (prefs.introSkip !== "always" || !v || !activeSkipRaw || activeSkipRaw.kind !== "intro") return;
    if (autoSkippedRef.current.has(activeSkipRaw.start)) return;
    autoSkippedRef.current.add(activeSkipRaw.start);
    const from = v.currentTime;
    v.currentTime = Math.min(activeSkipRaw.end, Number.isFinite(v.duration) ? v.duration - 1 : activeSkipRaw.end);
    setUndoSkip({ from });
    const t = setTimeout(() => setUndoSkip(null), 6000);
    return () => clearTimeout(t);
  }, [prefs.introSkip, activeSkipRaw?.start, activeSkipRaw?.kind]);
  const doSkip = () => {
    const v = videoRef.current;
    if (!v || !activeSkip) return;
    if (activeSkip.kind === "credits" && nextEpisode?.Id && !sleepAfterRef.current) {
      v.pause();
      setNextCountdown(0);
      return;
    }
    v.currentTime = Math.min(activeSkip.end, Number.isFinite(v.duration) ? v.duration - 1 : activeSkip.end);
  };

  function fmtTime(secs: number) {
    if (!Number.isFinite(secs) || secs <= 0) return "0:00";
    const s = Math.floor(secs % 60);
    const m = Math.floor((secs / 60) % 60);
    const h = Math.floor(secs / 3600);
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
  }

  // ---- Overlay chrome visibility -------------------------------------------
  // Controls stay on screen while paused, appear on any interaction, and fade
  // away again a few seconds after playback resumes so nothing covers the film.
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChromeVisible(false), 4000);
  }, []);

  useEffect(() => {
    if (paused && !isTv) {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
      setChromeVisible(true);
      return;
    }
    bumpChrome();
  }, [paused, isTv, bumpChrome]);

  useEffect(() => {
    const onActivity = () => bumpChrome();
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onActivity);
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
    };
  }, [bumpChrome]);

  // ---- Picture in picture ---------------------------------------------------
  // Lets the video float in a small always-on-top window while the viewer uses
  // other apps/tabs. Not offered on TV (no windowing) or where unsupported.
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPipSupported(!!(document as any).pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    v.addEventListener("enterpictureinpicture", onEnter);
    v.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      v.removeEventListener("enterpictureinpicture", onEnter);
      v.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current as any;
    if (!v) return;
    try {
      if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture();
      else await v.requestPictureInPicture?.();
    } catch {
      setError("Picture in picture isn't available on this device.");
    }
    bumpChrome();
  }, [bumpChrome]);

  // Collapse the expanded panels as soon as the chrome fades out.
  useEffect(() => {
    if (!chromeVisible) {
      setShowPanel(false);
      setShowDetails(false);
    }
  }, [chromeVisible]);


  // ---- Remote / keyboard control -------------------------------------------
  // Android TV WebViews don't let a D-pad reach the native <video controls>
  // widget, so playback is driven from key events plus our own button row.
  const [seekHint, setSeekHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashHint(text: string) {
    setSeekHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setSeekHint(null), 1200);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => {});
    else v.pause();
  }

  function seekBy(delta: number) {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) {
      if (v) v.currentTime = Math.max(0, v.currentTime + delta);
    } else {
      v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration - 1);
    }
    flashHint(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`);
  }

  useEffect(() => {
    // Move focus to the nearest visible control in the arrow's direction, so
    // the remote can reach every button in the top bar, the transport row and
    // any open panel (subtitles, language, options…).
    function moveFocus(dir: string, from: HTMLElement | null): boolean {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          'header button, header a[href], [data-player-chrome] button, [data-player-chrome] a[href], [data-player-chrome] select, [data-player-chrome] input, [data-player-panel] button, [data-player-panel] select, [data-player-panel] input',
        ),
      ).filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null && x.getClientRects().length > 0);
      if (!items.length) return false;
      if (!from || !items.includes(from)) {
        (items.find((x) => x.closest("[data-player-chrome]")) ?? items[0])!.focus();
        return true;
      }
      const a = from.getBoundingClientRect();
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best: HTMLElement | null = null;
      let bestScore = Infinity;
      for (const x of items) {
        if (x === from) continue;
        const r = x.getBoundingClientRect();
        const dx = r.left + r.width / 2 - ax;
        const dy = r.top + r.height / 2 - ay;
        let main: number, cross: number;
        if (dir === "ArrowRight") { if (dx <= 4) continue; main = dx; cross = Math.abs(dy); }
        else if (dir === "ArrowLeft") { if (dx >= -4) continue; main = -dx; cross = Math.abs(dy); }
        else if (dir === "ArrowDown") { if (dy <= 4) continue; main = dy; cross = Math.abs(dx); }
        else { if (dy >= -4) continue; main = -dy; cross = Math.abs(dx); }
        const score = main + cross * 3;
        if (score < bestScore) { bestScore = score; best = x; }
      }
      best?.focus();
      return true;
    }

    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const arrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      const inChrome = Boolean(
        el?.closest('[data-player-chrome], header, [data-player-panel]'),
      );
      if (inChrome) {
        if (!arrow) return; // Enter / Space press the focused button natively.
        // Seek bar keeps left/right for scrubbing.
        if (el?.tagName === "INPUT" && (el as HTMLInputElement).type === "range" &&
            (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
        e.preventDefault();
        e.stopPropagation();
        bumpChrome();
        moveFocus(e.key, el);
        return;
      }
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      switch (e.key) {
        case " ":
        case "Enter":
        case "MediaPlayPause":
        case "MediaPlay":
        case "MediaPause":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
        case "MediaFastForward":
        case "MediaTrackNext":
          e.preventDefault();
          seekBy(e.shiftKey ? 60 : 10);
          break;
        case "ArrowLeft":
        case "MediaRewind":
        case "MediaTrackPrevious":
          e.preventDefault();
          seekBy(e.shiftKey ? -60 : -10);
          break;
        case "ArrowUp":
        case "ArrowDown": {
          // Remote up/down reveals the controls and puts focus on them.
          e.preventDefault();
          bumpChrome();
          window.setTimeout(() => moveFocus(e.key, null), 50);
          break;
        }
        case "MediaStop":
          e.preventDefault();
          videoRef.current?.pause();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bumpChrome]);


  const decodeOptions: { id: DecodeMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "hardware", label: "Hardware" },
    { id: "software", label: "Software" },
  ];

  // ---- Native AndroidX Media3 / ExoPlayer handoff ---------------------------
  // Inside the APK the device decoders play MKV, Dolby Digital+ and HDR/DV
  // grades the WebView cannot, so playback moves to ExoPlayer.
  const [nativePlayer, setNativePlayer] = useState(false);
  const handedOff = useRef(false);

  useEffect(() => {
    void media3Available().then(setNativePlayer);
  }, []);

  async function playNative() {
    const chosen = textSubs.find((s) => s.index === subIndex);
    const url = streamUrl(server, itemId, {
      mode: "direct",
      session: sessionId,
      maxBitrate: prefs.maxBitrate,
      maxHeight: prefs.maxHeight,
      hdr: hdrParam,
      // ExoPlayer decodes Dolby Digital / Digital Plus, DTS and TrueHD with the
      // device's own decoders, so ask the server to keep the original audio
      // instead of transcoding it down to AAC stereo.
      audioCodec: ["eac3", "ac3", "dts", "truehd", "aac", "mp3"],
      audioChannels: prefs.audioChannels,
      audioIndex: audioIndex ?? undefined,
      version,
      container: check?.directContainer ?? "mkv",
      remux: false,
    });
    const ok = await media3Play({
      url,
      title: itemQ.data?.item?.Name ?? "",
      subtitleUrl: chosen ? embySubtitleUrl(server, itemId, chosen.mediaSourceId, chosen.index) : undefined,
      subtitleLang: chosen?.lang || "und",
      startPositionMs: Math.floor((videoRef.current?.currentTime ?? 0) * 1000),
      tunneling: prefs.afr !== "off",
    });
    if (ok) videoRef.current?.pause();
    else setError("The device player couldn't be opened — staying on the built-in player.");
  }

  useEffect(() => {
    if (!nativePlayer || handedOff.current || !mode) return;
    handedOff.current = true;
    void playNative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativePlayer, mode]);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
      <header
        className={`absolute top-0 left-0 right-0 z-30 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-6 py-3 transition-opacity duration-200 ${
          chromeVisible ? "opacity-100" : "invisible pointer-events-none opacity-0"
        }`}
        aria-hidden={!chromeVisible}

      >
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



          {audioTracks.length > 1 && (
            <label className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <span className="opacity-70">Audio</span>
              <select
                value={audioIndex ?? ""}
                onChange={(e) =>
                  setAudioIndex(e.target.value === "" ? null : Number(e.target.value))
                }
                className="bg-transparent outline-none [&>option]:bg-black"
              >
                <option value="">Default</option>
                {audioTracks.map((a) => (
                  <option key={a.index} value={a.index}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
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

      {soundOpen && (
        <div
          data-player-panel
          className="absolute bottom-28 right-4 z-40 w-[min(92vw,340px)] space-y-3 rounded-xl border border-white/10 bg-black/85 p-4 text-sm backdrop-blur"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold">Sound</p>
            <button type="button" onClick={() => setSoundOpen(false)} className="rounded px-2 opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Close sound options">✕</button>
          </div>
          <label className="block">
            <span className="flex justify-between"><span>Volume boost</span><span>{Math.round(fx.boost * 100)}%</span></span>
            <input type="range" min={1} max={2} step={0.1} value={fx.boost} onChange={(e) => updateFx({ boost: Number(e.target.value) })} className="w-full accent-primary" />
          </label>
          {[
            ["night", "Night mode", "Quieter bangs, louder whispers"],
            ["voice", "Clear voices", "Lifts speech over music and effects"],
            ["remember", "Remember volume", "Keeps your level between titles"],
          ].map(([k, label, hint]) => (
            <button
              key={k}
              type="button"
              onClick={() => updateFx({ [k]: !(fx as any)[k] } as any)}
              className="flex w-full items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span>
                <span className="block">{label}</span>
                <span className="block text-xs opacity-60">{hint}</span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${(fx as any)[k] ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>{(fx as any)[k] ? "On" : "Off"}</span>
            </button>
          ))}
          <label className="block">
            <span className="flex justify-between"><span>Audio sync (delay sound)</span><span>{fx.delayMs} ms</span></span>
            <input type="range" min={0} max={500} step={25} value={fx.delayMs} onChange={(e) => updateFx({ delayMs: Number(e.target.value) })} className="w-full accent-primary" />
          </label>
          {audioTracks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs opacity-70">Audio track</p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {audioTracks.map((a) => {
                  const on = audioIndex === a.index || (audioIndex === null && a.isDefault);
                  return (
                    <button
                      key={a.index}
                      type="button"
                      onClick={() => setAudioIndex(a.index)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${on ? "bg-primary text-primary-foreground" : "bg-white/5"}`}
                    >
                      <span>{a.label}</span>
                      {a.descriptive && <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px]">AD</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="rounded-lg bg-white/5 p-3 text-xs leading-relaxed">
            <p className="mb-1 font-medium">Sound in use now</p>
            <p>Volume: {muted ? "Muted" : `${Math.round(volume * 100)}%`}{fx.boost !== 1 ? ` × ${Math.round(fx.boost * 100)}% boost` : ""}</p>
            <p>Track: {(audioTracks.find((a) => a.index === audioIndex) ?? audioTracks.find((a) => a.isDefault) ?? audioTracks[0])?.label ?? "Default"}</p>
            <p>Speakers: {prefs.audioPassthrough ? "Passthrough to receiver" : "Stereo"}</p>
            <p>Effects: {[fx.night && "Night mode", fx.voice && "Clear voices", fx.delayMs && `${fx.delayMs} ms delay`].filter(Boolean).join(", ") || "None"}</p>
            {(fx.boost !== 1 || fx.night || fx.voice || fx.delayMs > 0) && prefs.audioPassthrough && (
              <p className="mt-1 opacity-70">Effects don't apply while passthrough sends sound straight to your receiver.</p>
            )}
          </div>
          <button type="button" onClick={() => updateFx({ boost: 1, night: false, voice: false, delayMs: 0 })} className="w-full rounded-lg bg-white/10 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white">Reset sound</button>
        </div>
      )}
      {showDetails && (
        <div data-player-panel className="absolute top-16 left-0 right-0 z-30 mx-6">
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
        <div data-player-panel className="absolute top-16 left-0 right-0 z-30 mx-6 max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-black/85 p-4 text-xs backdrop-blur">
          <div className="grid gap-4 sm:grid-cols-3">
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

      <h1 className="sr-only">{(itemQ.data?.item as any)?.Name ?? "Now Playing"}</h1>
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <video
          ref={videoRef}
          controls={false}
          onClick={togglePlay}

          playsInline
          crossOrigin="anonymous"
          className="absolute inset-0 m-auto h-full w-full bg-black object-contain"
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

        {paused && !chromeVisible && (
          <span className="pointer-events-none absolute top-4 right-4 rounded bg-black/50 px-2 py-1 text-xs font-medium opacity-60">
            Paused
          </span>
        )}


        {nextCountdown !== null && nextEpisode && (
          <div className="absolute right-6 bottom-24 max-w-xs rounded-xl border border-white/15 bg-black/80 p-4 backdrop-blur">
            <p className="text-xs uppercase tracking-wide opacity-70">Up next</p>
            <p className="mt-1 text-sm font-medium">{nextEpisodeLabel}</p>
            <p className="mt-1 text-xs opacity-70">Playing in {nextCountdown}s</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setNextCountdown(0)}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                ▶ Play now
              </button>
              <button
                type="button"
                onClick={() => setNextCountdown(null)}
                className="rounded bg-white/10 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}



        {undoSkip && (
          <button
            type="button"
            autoFocus
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = undoSkip.from; setUndoSkip(null); }}
            className="absolute right-6 bottom-36 z-40 rounded-lg border border-white/40 bg-black/70 px-5 py-3 text-base font-semibold text-white backdrop-blur focus:outline-none focus-visible:ring-4 focus-visible:ring-white"
          >
            Intro skipped · Undo ↩
          </button>
        )}

        {activeSkip && !undoSkip && !(prefs.introSkip === "always" && activeSkip.kind === "intro") && (
          <button
            type="button"
            onClick={doSkip}
            className="absolute right-6 bottom-36 z-40 rounded-lg border border-white/40 bg-black/70 px-5 py-3 text-base font-semibold text-white backdrop-blur focus:outline-none focus-visible:ring-4 focus-visible:ring-white"
          >
            {activeSkip.kind === "intro" ? "Skip Intro ⏭" : nextEpisode ? "Skip Credits · Next ⏭" : "Skip Credits ⏭"}
          </button>
        )}

        {(sleepLeft !== null || sleepAfterEpisode) && chromeVisible && (
          <span className="pointer-events-none absolute top-16 right-6 z-40 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
            😴 {sleepAfterEpisode ? "Sleep after this" : `Sleep in ${Math.ceil((sleepLeft ?? 0) / 60)} min`}
          </span>
        )}

        {seekHint && (
          <span className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium">
            {seekHint}
          </span>
        )}

        {/* Remote/touch-friendly transport bar. Auto-hides while something is playing. */}
        <div
          data-player-chrome="bottom"
          className={`absolute bottom-0 left-0 right-0 z-30 flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 pt-8 pb-5 transition-opacity duration-200 ${
            chromeVisible ? "opacity-100" : "invisible pointer-events-none opacity-0"
          }`}
          aria-hidden={!chromeVisible}
        >
          <div className="flex items-center gap-3 text-xs tabular-nums">
            <span className="w-14 text-right opacity-80">{fmtTime(position)}</span>
            <input
              type="range"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 0}
              step={1}
              value={position}
              aria-label="Seek"
              onChange={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number(e.target.value);
                setPosition(Number(e.target.value));
                bumpChrome();
              }}
              className="h-1.5 flex-1 cursor-pointer accent-primary"
            />
            <span className="w-14 opacity-80">{fmtTime(duration)}</span>
            {endsAt && <span className="hidden whitespace-nowrap opacity-70 sm:inline">Ends {endsAt}</span>}
            <select
              aria-label="Sleep timer"
              value={sleepAfterEpisode ? "ep" : sleepLeft !== null ? "on" : "off"}
              onChange={(e) => {
                const v = e.target.value;
                setSleepAfterEpisode(v === "ep");
                setSleepLeft(v === "off" || v === "ep" || v === "on" ? (v === "on" ? sleepLeft : null) : Number(v) * 60);
                bumpChrome();
              }}
              className="rounded-full bg-white/10 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <option value="off">Sleep: off</option>
              {sleepLeft !== null && <option value="on">Sleep: {Math.ceil(sleepLeft / 60)}m</option>}
              <option value="ep">After this</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
              <option value="90">90 min</option>
            </select>
          </div>
          {endsAt && <p className="text-center text-[11px] opacity-70 sm:hidden">Ends at {endsAt}</p>}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => seekBy(-60)}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ⏪ 60s
            </button>
            <button
              type="button"
              onClick={() => seekBy(-10)}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ◀ 10s
            </button>
            <button
              type="button"
              autoFocus
              onClick={togglePlay}
              className="rounded-full bg-white/20 px-5 py-2 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {paused ? "▶ Play" : "⏸ Pause"}
            </button>
            <button
              type="button"
              onClick={() => seekBy(10)}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              10s ▶
            </button>
            <button
              type="button"
              onClick={() => seekBy(60)}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              60s ⏩
            </button>

            <button
              type="button"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = !v.muted;
                setMuted(v.muted);
                bumpChrome();
              }}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {muted ? "🔇 Muted" : "🔊 Sound"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = videoRef.current;
                const next = Number(e.target.value);
                if (v) {
                  v.volume = next;
                  v.muted = next === 0;
                  setMuted(v.muted);
                }
                setVolume(next);
                bumpChrome();
              }}
              className="h-1.5 w-24 cursor-pointer accent-primary"
            />
            <button
              type="button"
              onClick={() => {
                setSoundOpen((o) => !o);
                bumpChrome();
              }}
              className={`rounded-full px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${soundOpen ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
            >
              🎚 Sound{audioFx.active && (fx.boost !== 1 || fx.night || fx.voice || fx.delayMs) ? " •" : ""}
            </button>

            <label className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm">
              <span className="opacity-70">Speed</span>
              <select
                value={speed}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSpeed(next);
                  const v = videoRef.current;
                  if (v) v.playbackRate = next;
                  bumpChrome();
                }}
                className="bg-transparent outline-none [&>option]:bg-black"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>

            {isEmbyFamily && textSubs.length > 0 && (
              <label className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm">
                <span className="opacity-70">Subtitles</span>
                <select
                  value={subIndex ?? ""}
                  onChange={(e) => {
                    setSubIndex(e.target.value === "" ? null : Number(e.target.value));
                    bumpChrome();
                  }}
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

            {audioTracks.length > 1 && (
              <label className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm">
                <span className="opacity-70">Audio</span>
                <select
                  value={audioIndex ?? ""}
                  onChange={(e) => {
                    setAudioIndex(e.target.value === "" ? null : Number(e.target.value));
                    bumpChrome();
                  }}
                  className="bg-transparent outline-none [&>option]:bg-black"
                >
                  <option value="">Default</option>
                  {audioTracks.map((a) => (
                    <option key={a.index} value={a.index}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {nextEpisode?.Id && (
              <button
                type="button"
                onClick={() => navigate({ to: "/watch/$id", params: { id: String(nextEpisode.Id) } })}
                className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                ⏭ Next episode
              </button>
            )}

            {pipSupported && !isTv && (
              <button
                type="button"
                onClick={() => void togglePip()}
                aria-pressed={pipActive}
                className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {pipActive ? "⧉ Exit mini player" : "⧉ Mini player"}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
                else void (v.parentElement ?? v).requestFullscreen?.().catch(() => {});
                bumpChrome();
              }}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ⛶ Fullscreen
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPanel((v) => !v);
                bumpChrome();
              }}
              className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ⚙ Options
            </button>

            {nativePlayer && (
              <button
                type="button"
                onClick={() => void playNative()}
                className="rounded-full bg-white/10 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Device player
              </button>
            )}
          </div>
        </div>

      </div>

      {error && <p className="px-6 py-2 text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}
