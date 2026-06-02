// Trakt-powered home rails: Trending Movies / Shows, Recommended, Watchlist.
// Renders on top of the library page. Trending is public; the others require
// an authenticated session (set up in Settings).
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  traktTrending,
  traktRecommended,
  traktWatchlist,
} from "@/lib/trakt.functions";
import { getValidTraktToken, loadTraktSession } from "@/lib/trakt-client";

type TraktEntry = {
  movie?: { title: string; year?: number; ids: { imdb?: string; tmdb?: number; slug?: string } };
  show?: { title: string; year?: number; ids: { imdb?: string; tmdb?: number; slug?: string } };
};

function tmdbImageUrl(_e: TraktEntry): string | null {
  // We don't have TMDb wired yet; rails are text-first cards. Once TMDb is
  // added, swap this for poster lookups by tmdb id.
  return null;
}

function entryKey(e: TraktEntry, i: number) {
  const m = e.movie ?? e.show;
  return m?.ids.slug ?? m?.ids.imdb ?? String(m?.ids.tmdb ?? i);
}

function entryTitle(e: TraktEntry) {
  const m = e.movie ?? e.show;
  return m?.title ?? "Untitled";
}

function entryYear(e: TraktEntry) {
  return (e.movie ?? e.show)?.year;
}

function useTraktToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      void getValidTraktToken().then((t) => {
        if (!cancelled) setToken(t);
      });
    }
    refresh();
    window.addEventListener("trakt:session", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("trakt:session", refresh);
    };
  }, []);
  return token;
}

export function TraktRails() {
  const token = useTraktToken();
  const hasSession = !!loadTraktSession();
  const trendingMovies = useServerFn(traktTrending);
  const trendingShows = useServerFn(traktTrending);
  const recommended = useServerFn(traktRecommended);
  const watchlist = useServerFn(traktWatchlist);

  const movies = useQuery({
    queryKey: ["trakt", "trending", "movies"],
    queryFn: () => trendingMovies({ data: { kind: "movies", limit: 20 } }),
    staleTime: 30 * 60 * 1000,
  });
  const shows = useQuery({
    queryKey: ["trakt", "trending", "shows"],
    queryFn: () => trendingShows({ data: { kind: "shows", limit: 20 } }),
    staleTime: 30 * 60 * 1000,
  });
  const recs = useQuery({
    enabled: !!token,
    queryKey: ["trakt", "recommended", token ? "y" : "n"],
    queryFn: () =>
      recommended({ data: { accessToken: token!, kind: "movies", limit: 20 } }),
  });
  const wl = useQuery({
    enabled: !!token,
    queryKey: ["trakt", "watchlist", token ? "y" : "n"],
    queryFn: () => watchlist({ data: { accessToken: token! } }),
  });

  if (!hasSession && !movies.data && !shows.data) return null;

  return (
    <>
      {movies.data?.items?.length ? (
        <TraktSection title="Trending movies on Trakt" items={movies.data.items} />
      ) : null}
      {shows.data?.items?.length ? (
        <TraktSection title="Trending TV on Trakt" items={shows.data.items} />
      ) : null}
      {token && recs.data?.items?.length ? (
        <TraktSection title="Recommended for you" items={recs.data.items} />
      ) : null}
      {token && wl.data?.items?.length ? (
        <TraktSection title="Your watchlist" items={wl.data.items} />
      ) : null}
    </>
  );
}

function TraktSection({ title, items }: { title: string; items: TraktEntry[] }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {items.map((it, i) => {
          const img = tmdbImageUrl(it);
          return (
            <div
              key={entryKey(it, i)}
              className="flex-shrink-0"
              style={{ width: 160 }}
            >
              <div
                className="flex items-center justify-center overflow-hidden rounded-lg bg-muted px-3 text-center text-xs text-muted-foreground ring-1 ring-border"
                style={{ aspectRatio: "2/3" }}
              >
                {img ? (
                  <img src={img} alt={entryTitle(it)} className="h-full w-full object-cover" />
                ) : (
                  <span className="line-clamp-4">{entryTitle(it)}</span>
                )}
              </div>
              <p className="mt-2 line-clamp-1 text-sm font-medium">{entryTitle(it)}</p>
              {entryYear(it) && (
                <p className="text-xs text-muted-foreground">{entryYear(it)}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
