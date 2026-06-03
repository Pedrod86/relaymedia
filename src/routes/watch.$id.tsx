import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  embyHlsStreamUrl,
  embyDirectStreamUrl,
  embySubtitleUrl,
  plexDirectStreamUrl,
  loadActiveServer,
  type MediaServer,
} from "@/lib/media-client";
import { embyGetItem } from "@/lib/emby.functions";
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
  const [mode, setMode] = useState<"hls" | "direct">(server.kind === "plex" ? "direct" : "hls");
  const [error, setError] = useState<string | null>(null);
  const [subIndex, setSubIndex] = useState<number | null>(null); // null = off
  const getPlexStream = useServerFn(plexGetStreamInfo);
  const getItemEmby = useServerFn(embyGetItem);

  const isEmbyFamily = server.kind !== "plex";

  // Fetch item to discover subtitle streams (Emby / Jellyfin only).
  const itemQ = useQuery({
    enabled: isEmbyFamily,
    queryKey: ["watch-item", server.id, itemId],
    queryFn: () =>
      getItemEmby({
        data: {
          serverUrl: server.serverUrl,
          token: server.token,
          userId: server.userId,
          itemId,
        },
      }),
  });

  const subtitles: SubTrack[] = useMemo(() => {
    if (!isEmbyFamily) return [];
    const item: any = itemQ.data?.item;
    const sources: any[] = item?.MediaSources ?? [];
    const out: SubTrack[] = [];
    for (const src of sources) {
      const sid = src.Id ?? itemId;
      for (const st of src.MediaStreams ?? []) {
        if (st.Type !== "Subtitle") continue;
        const isText = st.IsTextSubtitleStream || ["srt", "vtt", "ass", "ssa", "sub"].includes((st.Codec || "").toLowerCase());
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    let hlsInstance: Hls | null = null;
    let cancelled = false;

    async function start() {
      if (!video) return;

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

      video.src = embyDirectStreamUrl(server, itemId);
      video.play().catch(() => setError("Your browser cannot play this stream."));
    }

    void start();
    return () => {
      cancelled = true;
      hlsInstance?.destroy();
    };
  }, [server, itemId, mode, getPlexStream]);

  // Force the chosen <track> to "showing" — browsers default to "disabled".
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const wanted = subIndex !== null && (t as any).__embyIndex === subIndex;
      t.mode = wanted ? "showing" : "disabled";
    }
  }, [subIndex, subtitles]);

  const textSubs = subtitles.filter((s) => s.isText);

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
        <Link to="/item/$id" params={{ id: itemId }} className="text-sm opacity-80 hover:opacity-100">
          ← Back
        </Link>
        <div className="flex flex-wrap gap-2 text-xs">
          {isEmbyFamily && (
            <>
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
            </>
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
          {isEmbyFamily && subtitles.length > 0 && textSubs.length === 0 && (
            <span className="rounded bg-white/10 px-2 py-1 opacity-70">
              Image-based subtitles — switch to Direct & burn-in not yet supported
            </span>
          )}
        </div>
      </header>
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
