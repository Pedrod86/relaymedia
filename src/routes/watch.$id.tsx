import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import {
  embyHlsStreamUrl,
  embyDirectStreamUrl,
  plexDirectStreamUrl,
  loadActiveServer,
  type MediaServer,
} from "@/lib/media-client";
import { plexGetStreamInfo } from "@/lib/plex.functions";

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
  if (!server) return null;
  return <Player server={server} itemId={id} />;
}

function Player({ server, itemId }: { server: MediaServer; itemId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"hls" | "direct">(server.kind === "plex" ? "direct" : "hls");
  const [error, setError] = useState<string | null>(null);
  const getPlexStream = useServerFn(plexGetStreamInfo);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    let hlsInstance: Hls | null = null;
    let cancelled = false;

    async function start() {
      if (!video) return;

      // ── Plex: direct play only (resolve Part.key first) ──
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
        return;
      }

      // ── Emby / Jellyfin ──
      if (mode === "direct") {
        video.src = embyDirectStreamUrl(server, itemId);
        video.play().catch(() => {});
        return;
      }

      const src = embyHlsStreamUrl(server, itemId);

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => {});
        return;
      }

      if (Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
        hlsInstance.loadSource(src);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            console.error("HLS fatal", data);
            setError(`Playback error: ${data.type} / ${data.details}. Trying direct stream…`);
            hlsInstance?.destroy();
            setMode("direct");
          }
        });
        return;
      }

      // Last resort
      video.src = embyDirectStreamUrl(server, itemId);
      video.play().catch(() => setError("Your browser cannot play this stream."));
    }

    void start();
    return () => {
      cancelled = true;
      hlsInstance?.destroy();
    };
  }, [server, itemId, mode, getPlexStream]);

  const isEmbyFamily = server.kind !== "plex";

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between px-6 py-3">
        <Link to="/item/$id" params={{ id: itemId }} className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        {isEmbyFamily && (
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setMode("hls")}
              className={`rounded px-2 py-1 ${mode === "hls" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
            >
              HLS (adaptive)
            </button>
            <button
              onClick={() => setMode("direct")}
              className={`rounded px-2 py-1 ${mode === "direct" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
            >
              Direct
            </button>
          </div>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center">
        <video
          ref={videoRef}
          controls
          playsInline
          className="h-full max-h-[88vh] w-full bg-black"
        />
      </div>
      {error && <p className="px-6 py-2 text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}
