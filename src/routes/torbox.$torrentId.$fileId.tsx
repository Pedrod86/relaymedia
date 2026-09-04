import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MonitorPlay, PictureInPicture2 } from "lucide-react";
import { torboxPlayUrl } from "@/lib/torbox.functions";
import { media3Available, media3Play } from "@/lib/native-player";
import { isTvDevice } from "@/lib/platform";

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}


export const Route = createFileRoute("/torbox/$torrentId/$fileId")({
  component: TorboxPlayer,
  validateSearch: (search: Record<string, unknown>) => ({
    title: typeof search.title === "string" ? search.title : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Playing from TorBox cloud — Relay Media" },
      {
        name: "description",
        content:
          "Stream a file straight from your TorBox cloud in Relay Media, with device-decoder playback on Android.",
      },
      { property: "og:title", content: "Playing from TorBox cloud — Relay Media" },
      {
        property: "og:description",
        content: "Stream TorBox cloud downloads directly inside Relay Media.",
      },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function TorboxPlayer() {
  const { torrentId, fileId } = Route.useParams();
  const { title } = Route.useSearch();
  const playUrlFn = useServerFn(torboxPlayUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativePlayer, setNativePlayer] = useState(false);
  const handedOff = useRef(false);
  const [isTv, setIsTv] = useState(false);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<{ index: number; label: string }[]>([]);
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), 4000);
  }, []);


  const link = useQuery({
    queryKey: ["torbox-play", torrentId, fileId],
    queryFn: () =>
      playUrlFn({ data: { torrentId: Number(torrentId), fileId: Number(fileId) } }),
    staleTime: 0,
    gcTime: 0,
  });

  const url = link.data?.ok ? link.data.url : null;

  useEffect(() => {
    void media3Available().then(setNativePlayer);
    setIsTv(isTvDevice());
    setPipSupported(typeof document !== "undefined" && !!(document as any).pictureInPictureEnabled);
  }, []);

  // Keep the transport bar in sync with the video element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;
    const sync = () => {
      setPosition(v.currentTime);
      setPaused(v.paused);
    };
    const onDuration = () => setDuration(v.duration || 0);
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onMeta = () => {
      onDuration();
      onVolume();
      const tracks = Array.from(v.textTracks).map((t, i) => ({
        index: i,
        label: t.label || t.language || `Subtitle ${i + 1}`,
      }));
      setSubtitleTracks(tracks);
    };
    const onPip = () => setPipActive(!!(document as any).pictureInPictureElement);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("volumechange", onVolume);
    v.addEventListener("enterpictureinpicture", onPip);
    v.addEventListener("leavepictureinpicture", onPip);
    return () => {
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("volumechange", onVolume);
      v.removeEventListener("enterpictureinpicture", onPip);
      v.removeEventListener("leavepictureinpicture", onPip);
    };
  }, [url]);

  // Autoplay: browsers block sound-on autoplay, so retry muted rather than sit paused.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url || nativePlayer) return;
    const start = async () => {
      try {
        await v.play();
      } catch {
        v.muted = true;
        setMuted(true);
        try {
          await v.play();
        } catch {
          setPaused(true);
        }
      }
    };
    void start();
  }, [url, nativePlayer]);

  useEffect(() => {
    if (paused && !isTv) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setChromeVisible(true);
    } else {
      bumpChrome();
    }
  }, [paused, isTv, bumpChrome]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  async function playNative(streamUrl: string) {
    const ok = await media3Play({
      url: streamUrl,
      title: title ?? "TorBox",
      startPositionMs: Math.floor((videoRef.current?.currentTime ?? 0) * 1000),
    });
    if (ok) videoRef.current?.pause();
    else setError("The device player couldn't be opened — staying on the built-in player.");
  }

  // On Android the device decoders handle MKV, E-AC3 and HDR the WebView cannot,
  // so hand the TorBox stream to ExoPlayer as soon as the link resolves.
  useEffect(() => {
    if (!nativePlayer || handedOff.current || !url) return;
    handedOff.current = true;
    void playNative(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativePlayer, url]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    bumpChrome();
  }, [bumpChrome]);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min((v.duration || 0) || v.currentTime + delta, v.currentTime + delta));
      bumpChrome();
    },
    [bumpChrome],
  );

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

  function selectSubtitle(index: number) {
    const v = videoRef.current;
    setSubtitleIndex(index);
    if (!v) return;
    Array.from(v.textTracks).forEach((t, i) => {
      t.mode = i === index ? "showing" : "disabled";
    });
    bumpChrome();
  }

  const btn = "rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60";

  return (
    <main
      className="relative flex min-h-screen flex-col bg-black text-white"
      onMouseMove={bumpChrome}
      onTouchStart={bumpChrome}
      onKeyDown={bumpChrome}
      onClick={bumpChrome}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-2 px-6 py-3 transition-opacity ${chromeVisible ? "opacity-100" : "invisible pointer-events-none opacity-0"}`}
        aria-hidden={!chromeVisible}
      >
        <Link to="/" className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        <h1 className="line-clamp-1 text-sm opacity-80">{title ?? "TorBox cloud"}</h1>
        {url && nativePlayer && (
          <button type="button" onClick={() => playNative(url)} className={`flex items-center gap-1 ${btn}`}>
            <MonitorPlay className="h-4 w-4" /> Device player
          </button>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center">
        {link.isLoading ? (
          <p className="flex items-center gap-2 text-sm opacity-80">
            <Loader2 className="h-4 w-4 animate-spin" /> Resolving your TorBox stream…
          </p>
        ) : !url ? (
          <p className="max-w-md px-6 text-center text-sm text-red-300">
            {link.data && !link.data.ok
              ? link.data.error
              : "TorBox didn't return a playable link for this file."}
          </p>
        ) : (
          <video
            ref={videoRef}
            src={url}
            controls={false}
            autoPlay
            playsInline
            crossOrigin="anonymous"
            className="max-h-[80vh] w-full bg-black"
            onClick={togglePlay}
            onError={() =>
              setError(
                "This file's video or audio codec isn't supported by the browser player. On Android, try the device player.",
              )
            }
          />
        )}
      </div>

      {paused && !chromeVisible && (
        <span className="absolute right-4 top-4 rounded bg-black/50 px-2 py-1 text-[10px] uppercase tracking-wide opacity-60">
          Paused
        </span>
      )}

      {url && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent px-4 pb-4 pt-10 transition-opacity ${chromeVisible ? "opacity-100" : "invisible pointer-events-none opacity-0"}`}
          aria-hidden={!chromeVisible}
        >
          <div className="flex items-center gap-3 text-[11px] tabular-nums">
            <span>{fmtTime(position)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={Math.min(position, duration || 0)}
              onChange={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number(e.target.value);
                setPosition(Number(e.target.value));
                bumpChrome();
              }}
              aria-label="Seek"
              className="h-1 flex-1 accent-white"
            />
            <span>{fmtTime(duration)}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => seekBy(-60)} className={btn} aria-label="Back 60 seconds">
              ⏪ 60s
            </button>
            <button type="button" onClick={() => seekBy(-10)} className={btn} aria-label="Back 10 seconds">
              ◀ 10s
            </button>
            <button type="button" onClick={togglePlay} className={btn} aria-label={paused ? "Play" : "Pause"}>
              {paused ? "▶ Play" : "⏸ Pause"}
            </button>
            <button type="button" onClick={() => seekBy(10)} className={btn} aria-label="Forward 10 seconds">
              10s ▶
            </button>
            <button type="button" onClick={() => seekBy(60)} className={btn} aria-label="Forward 60 seconds">
              60s ⏩
            </button>

            <button
              type="button"
              onClick={() => {
                const v = videoRef.current;
                if (v) v.muted = !v.muted;
                bumpChrome();
              }}
              className={btn}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = videoRef.current;
                if (v) {
                  v.volume = Number(e.target.value);
                  v.muted = Number(e.target.value) === 0;
                }
                bumpChrome();
              }}
              aria-label="Volume"
              className="h-1 w-20 accent-white"
            />

            <label className="flex items-center gap-1 text-[11px] opacity-80">
              Speed
              <select
                value={speed}
                onChange={(e) => {
                  const rate = Number(e.target.value);
                  setSpeed(rate);
                  const v = videoRef.current;
                  if (v) v.playbackRate = rate;
                  bumpChrome();
                }}
                className="rounded bg-white/10 px-2 py-1 text-xs"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r} className="bg-black">
                    {r}×
                  </option>
                ))}
              </select>
            </label>

            {subtitleTracks.length > 0 && (
              <label className="flex items-center gap-1 text-[11px] opacity-80">
                Subtitles
                <select
                  value={subtitleIndex}
                  onChange={(e) => selectSubtitle(Number(e.target.value))}
                  className="rounded bg-white/10 px-2 py-1 text-xs"
                >
                  <option value={-1} className="bg-black">
                    Off
                  </option>
                  {subtitleTracks.map((t) => (
                    <option key={t.index} value={t.index} className="bg-black">
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {pipSupported && !isTv && (
              <button type="button" onClick={togglePip} className={`flex items-center gap-1 ${btn}`}>
                <PictureInPicture2 className="h-4 w-4" />
                {pipActive ? "Exit mini player" : "Mini player"}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const v = videoRef.current as any;
                if (!v) return;
                if (document.fullscreenElement) void document.exitFullscreen();
                else void (v.requestFullscreen?.() ?? v.webkitEnterFullscreen?.());
                bumpChrome();
              }}
              className={btn}
            >
              ⛶ Fullscreen
            </button>

            {url && (
              <button type="button" onClick={() => playNative(url)} className={`flex items-center gap-1 ${btn}`}>
                <MonitorPlay className="h-4 w-4" /> Device player
              </button>
            )}
          </div>

          {error && <p className="mt-2 text-center text-xs text-amber-300">{error}</p>}
        </div>
      )}

      {!url && error && <p className="px-6 py-3 text-center text-xs text-amber-300">{error}</p>}
    </main>
  );

}
