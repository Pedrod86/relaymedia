// YouTube trailers/extras + "Where to watch" for a movie or show page.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Play, X } from "lucide-react";
import { tmdbExtras, type TmdbProvider } from "@/lib/tmdb.functions";
import { Button } from "@/components/ui/button";

/** Search pages for well-known services — opens the app on phones/TVs that handle the link. */
function searchUrl(name: string, title: string): string {
  const q = encodeURIComponent(title);
  const n = name.toLowerCase();
  if (n.includes("netflix")) return `https://www.netflix.com/search?q=${q}`;
  if (n.includes("amazon") || n.includes("prime")) return `https://www.primevideo.com/search/ref=atv_nb_sug?phrase=${q}`;
  if (n.includes("disney")) return `https://www.disneyplus.com/search?q=${q}`;
  if (n.includes("apple")) return `https://tv.apple.com/search?term=${q}`;
  if (n.includes("now")) return `https://www.nowtv.com/search?q=${q}`;
  if (n.includes("iplayer") || n.includes("bbc")) return `https://www.bbc.co.uk/iplayer/search?q=${q}`;
  if (n.includes("itv")) return `https://www.itv.com/watch/search?q=${q}`;
  if (n.includes("channel 4")) return `https://www.channel4.com/search?q=${q}`;
  if (n.includes("paramount")) return `https://www.paramountplus.com/search/?q=${q}`;
  if (n.includes("youtube")) return `https://www.youtube.com/results?search_query=${q}`;
  if (n.includes("google")) return `https://play.google.com/store/search?q=${q}&c=movies`;
  if (n.includes("max")) return `https://play.max.com/search?q=${q}`;
  if (n.includes("hulu")) return `https://www.hulu.com/search?q=${q}`;
  if (n.includes("plex")) return `https://watch.plex.tv/search?q=${q}`;
  if (n.includes("tubi")) return `https://tubitv.com/search/${q}`;
  if (n.includes("pluto")) return `https://pluto.tv/search/details?query=${q}`;
  return `https://www.justwatch.com/uk/search?q=${q}`;
}

const FALLBACK = ["Netflix", "Amazon Prime Video", "Disney Plus", "Apple TV", "NOW", "BBC iPlayer"];

function ProviderRow({ label, items, title }: { label: string; items: TmdbProvider[]; title: string }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((p) => (
          <a
            key={`${label}-${p.id}`}
            data-tv-card
            href={searchUrl(p.name, title)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {p.logo && <img src={p.logo} alt="" className="size-7 rounded" />}
            {p.name}
          </a>
        ))}
      </div>
    </div>
  );
}

export function TitleExtras({ item }: { item: any }) {
  const fn = useServerFn(tmdbExtras);
  const [playing, setPlaying] = useState<string | null>(null);
  const isShow = item?.Type === "Series";
  const isMovie = item?.Type === "Movie";
  const title = String(item?.Name ?? "");
  const ids = item?.ProviderIds ?? {};
  const get = (k: string) => {
    const hit = Object.entries(ids).find(([key]) => key.toLowerCase() === k);
    return hit ? String(hit[1]) : undefined;
  };
  const region =
    typeof navigator !== "undefined" ? (navigator.language.split("-")[1] ?? "GB").toUpperCase() : "GB";

  const q = useQuery({
    queryKey: ["tmdb-extras", item?.Id, region],
    enabled: (isShow || isMovie) && !!title,
    staleTime: 1000 * 60 * 60,
    queryFn: () =>
      fn({
        data: {
          type: isShow ? "tv" : "movie",
          tmdbId: get("tmdb"),
          imdbId: get("imdb"),
          title,
          year: item?.ProductionYear ?? undefined,
          region: region.length === 2 ? region : "GB",
        },
      }),
  });
  if (!isShow && !isMovie) return null;
  const d = q.data;
  const hasProviders = d && (d.stream.length || d.free.length || d.rent.length || d.buy.length);

  return (
    <>
      {d?.videos.length ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-semibold">Trailers & extras</h2>
          {playing && (
            <div className="relative mb-4 aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-muted">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${playing}?autoplay=1&rel=0`}
                title="Trailer"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
              <Button size="icon" variant="secondary" className="absolute right-2 top-2" onClick={() => setPlaying(null)} aria-label="Close video">
                <X />
              </Button>
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {d.videos.map((v) => (
              <button
                key={v.key}
                data-tv-card
                type="button"
                onClick={() => setPlaying(v.key)}
                className="group w-64 shrink-0 text-left focus:outline-none"
              >
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted ring-primary group-focus:ring-2">
                  <img src={`https://i.ytimg.com/vi/${v.key}/mqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-background/20 opacity-80 group-hover:opacity-100">
                    <Play className="size-10 fill-current" />
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm font-medium">{v.name}</p>
                <p className="text-xs text-muted-foreground">{v.type}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-semibold">Where to watch</h2>
        {hasProviders ? (
          <>
            <ProviderRow label="Stream" items={d!.stream} title={title} />
            <ProviderRow label="Free" items={d!.free} title={title} />
            <ProviderRow label="Rent" items={d!.rent} title={title} />
            <ProviderRow label="Buy" items={d!.buy} title={title} />
            <p className="text-xs text-muted-foreground">Availability data from JustWatch.</p>
          </>
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking streaming services…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {d?.configured ? "Not found on streaming services in your country — search them directly:" : "Search for it on:"}
            </p>
            <ProviderRow label="" items={FALLBACK.map((name, i) => ({ id: i, name, logo: null }))} title={title} />
          </>
        )}
      </section>
    </>
  );
}
