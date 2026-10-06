// TMDB lookups for title pages: YouTube trailers/extras and "where to watch"
// streaming availability (JustWatch data via TMDB). Key stays server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type TmdbVideo = { key: string; name: string; type: string; official: boolean };
export type TmdbProvider = { id: number; name: string; logo: string | null };
export type TmdbExtras = {
  configured: boolean;
  found: boolean;
  videos: TmdbVideo[];
  stream: TmdbProvider[];
  rent: TmdbProvider[];
  buy: TmdbProvider[];
  free: TmdbProvider[];
  link: string | null;
};

const EMPTY = (configured: boolean): TmdbExtras => ({
  configured,
  found: false,
  videos: [],
  stream: [],
  rent: [],
  buy: [],
  free: [],
  link: null,
});

const TYPE_ORDER = ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes", "Bloopers"];

export const tmdbExtras = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      type: z.enum(["movie", "tv"]),
      tmdbId: z.string().max(20).optional(),
      imdbId: z.string().max(20).optional(),
      title: z.string().max(200),
      year: z.number().int().optional(),
      region: z.string().length(2).default("GB"),
    }),
  )
  .handler(async ({ data }): Promise<TmdbExtras> => {
    const key = process.env["TMDB_API_KEY"];
    if (!key) return EMPTY(false);
    const bearer = key.length > 60;
    const get = async (path: string, params: Record<string, string> = {}) => {
      const u = new URL(`https://api.themoviedb.org/3${path}`);
      if (!bearer) u.searchParams.set("api_key", key);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      const r = await fetch(u, {
        headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`TMDB ${r.status}`);
      return r.json() as Promise<any>;
    };
    try {
      let id = data.tmdbId && /^\d+$/.test(data.tmdbId) ? data.tmdbId : null;
      if (!id && data.imdbId) {
        const f = await get(`/find/${data.imdbId}`, { external_source: "imdb_id" });
        id = String((data.type === "movie" ? f.movie_results : f.tv_results)?.[0]?.id ?? "") || null;
      }
      if (!id && data.title) {
        const s = await get(`/search/${data.type}`, {
          query: data.title,
          ...(data.year ? { [data.type === "movie" ? "year" : "first_air_date_year"]: String(data.year) } : {}),
        });
        id = s.results?.[0]?.id ? String(s.results[0].id) : null;
      }
      if (!id) return EMPTY(true);
      const [v, p] = await Promise.all([
        get(`/${data.type}/${id}/videos`).catch(() => ({ results: [] })),
        get(`/${data.type}/${id}/watch/providers`).catch(() => ({ results: {} })),
      ]);
      const videos: TmdbVideo[] = (v.results ?? [])
        .filter((x: any) => x.site === "YouTube" && x.key)
        .map((x: any) => ({ key: x.key, name: x.name, type: x.type, official: !!x.official }))
        .sort((a: TmdbVideo, b: TmdbVideo) => {
          const ia = TYPE_ORDER.indexOf(a.type), ib = TYPE_ORDER.indexOf(b.type);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || Number(b.official) - Number(a.official);
        })
        .slice(0, 12);
      const reg = p.results?.[data.region.toUpperCase()] ?? {};
      const map = (arr: any[] | undefined): TmdbProvider[] =>
        (arr ?? []).map((x) => ({
          id: x.provider_id,
          name: x.provider_name,
          logo: x.logo_path ? `https://image.tmdb.org/t/p/w92${x.logo_path}` : null,
        }));
      return {
        configured: true,
        found: true,
        videos,
        stream: map(reg.flatrate),
        free: [...map(reg.free), ...map(reg.ads)],
        rent: map(reg.rent),
        buy: map(reg.buy),
        link: reg.link ?? null,
      };
    } catch (e) {
      console.error("tmdbExtras", e);
      return EMPTY(true);
    }
  });
