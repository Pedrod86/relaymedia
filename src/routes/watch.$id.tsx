import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import {
  hlsStreamUrl,
  directStreamUrl,
  loadSession,
  type EmbySession,
} from "@/lib/emby-client";

export const Route = createFileRoute("/watch/$id")({
  head: () => ({ meta: [{ title: "Watch — Emby" }] }),
  component: WatchPage,
});

function WatchPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [session, setSession] = useState<EmbySession | null>(null);
  useEffect(() => {
    const s = loadSession();
    if (!s) navigate({ to: "/login" });
    else setSession(s);
  }, [navigate]);
  if (!session) return null;
  return <Player session={session} itemId={id} />;
}

function Player({ session, itemId }: { session: EmbySession; itemId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"hls" | "direct">("hls");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    if (mode === "direct") {
      video.src = directStreamUrl(session, itemId);
      video.play().catch(() => {});
      return;
    }

    const src = hlsStreamUrl(session, itemId);

    // Safari + iOS play HLS natively (hardware-accelerated where supported).
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.play().catch(() => {});
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          console.error("HLS fatal", data);
          setError(`Playback error: ${data.type} / ${data.details}. Trying direct stream…`);
          hls.destroy();
          setMode("direct");
        }
      });
      return () => hls.destroy();
    }

    // Last resort: try direct stream.
    video.src = directStreamUrl(session, itemId);
    video.play().catch(() => setError("Your browser cannot play this stream."));
  }, [session, itemId, mode]);

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between px-6 py-3">
        <Link to="/item/$id" params={{ id: itemId }} className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
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
