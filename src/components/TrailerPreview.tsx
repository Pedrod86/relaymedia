// Playable trailer preview for a movie or TV show.
//
// Trailers come from the media server itself (local trailer files / Plex
// extras, streamed through the authenticated media proxy) or from remote
// trailer metadata (usually YouTube), which is embedded in an iframe.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { embyGetTrailers } from "@/lib/emby.functions";
import { plexGetTrailers } from "@/lib/plex.functions";
import { plexDirectStreamUrl, streamUrl, type MediaServer } from "@/lib/media-client";
import { Button } from "@/components/ui/button";

type Trailer =
  | { source: "local"; id: string; name: string }
  | { source: "part"; partKey: string; name: string }
  | { source: "external"; url: string; name: string };

/** youtube.com/watch?v=, youtu.be/, /embed/ → embeddable URL. */
function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host.endsWith("youtube.com")) {
      id = u.searchParams.get("v") ?? (u.pathname.startsWith("/embed/") ? u.pathname.slice(7) : null);
    }
    if (!id) return null;
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  } catch {
    return null;
  }
}

export function TrailerPreview({
  server,
  itemId,
  title,
}: {
  server: MediaServer;
  itemId: string;
  title: string;
}) {
  const isPlex = server.kind === "plex";
  const getEmby = useServerFn(embyGetTrailers);
  const getPlex = useServerFn(plexGetTrailers);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const q = useQuery({
    queryKey: ["trailers", server.id, itemId],
    queryFn: () =>
      isPlex
        ? getPlex({ data: { serverId: server.id, itemId } })
        : getEmby({ data: { serverId: server.id, itemId } }),
  });

  const trailers = (q.data?.trailers ?? []) as Trailer[];
  const current = trailers[index];

  // Close on Escape and pause playback when the overlay closes.
  useEffect(() => {
    if (!open) {
      videoRef.current?.pause();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (q.isLoading) {
    return (
      <Button size="lg" variant="secondary" disabled>
        Looking for trailer…
      </Button>
    );
  }
  if (trailers.length === 0) return null;

  const embed = current?.source === "external" ? youtubeEmbed(current.url) : null;
  const videoSrc =
    current?.source === "local"
      ? streamUrl(server, current.id, { mode: "direct" })
      : current?.source === "part"
        ? plexDirectStreamUrl(server, current.partKey)
        : null;

  return (
    <>
      <Button size="lg" variant="secondary" onClick={() => setOpen(true)}>
        ▶ Watch trailer
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-label={`${title} trailer`}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
              <p className="truncate text-sm font-medium">
                {title} — {current?.name ?? "Trailer"}
              </p>
              <button
                onClick={() => setOpen(false)}
                className="rounded px-2 text-muted-foreground hover:text-foreground"
                aria-label="Close trailer"
              >
                ✕
              </button>
            </div>

            <div className="aspect-video w-full bg-black">
              {embed ? (
                <iframe
                  src={embed}
                  title={`${title} trailer`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : videoSrc ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  autoPlay
                  playsInline
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  This trailer can’t be played in the browser.{" "}
                  {current?.source === "external" && (
                    <a href={current.url} target="_blank" rel="noreferrer" className="ml-1 underline">
                      Open externally
                    </a>
                  )}
                </div>
              )}
            </div>

            {trailers.length > 1 && (
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {trailers.map((t, i) => (
                  <button
                    key={`${t.source}-${i}`}
                    onClick={() => setIndex(i)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      i === index ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {t.name || `Trailer ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
