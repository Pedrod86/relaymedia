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
  }, []);

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

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
        <Link to="/" className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        <h1 className="line-clamp-1 text-sm opacity-80">{title ?? "TorBox cloud"}</h1>
        {url && (
          <>
            <button
              type="button"
              onClick={async () => {
                const v = videoRef.current as any;
                if (!v) return;
                try {
                  if ((document as any).pictureInPictureElement)
                    await (document as any).exitPictureInPicture();
                  else await v.requestPictureInPicture?.();
                } catch {
                  setError("Picture in picture isn't available on this device.");
                }
              }}
              className="flex items-center gap-1 rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            >
              <PictureInPicture2 className="h-4 w-4" /> Mini player
            </button>
            <button
              type="button"
              onClick={() => playNative(url)}
              className="flex items-center gap-1 rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            >
              <MonitorPlay className="h-4 w-4" /> Device player
            </button>
          </>
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
            controls
            autoPlay
            playsInline
            crossOrigin="anonymous"
            className="max-h-[80vh] w-full bg-black"
            onError={() =>
              setError(
                "This file's video or audio codec isn't supported by the browser player. On Android, try the device player.",
              )
            }
          />
        )}
      </div>

      {error && <p className="px-6 py-3 text-center text-xs text-amber-300">{error}</p>}
    </main>
  );
}
