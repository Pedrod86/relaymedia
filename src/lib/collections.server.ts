// Fetch list contents from MDBList, TMDB, TVDB and Trakt and normalise them
// into CollectionItem rows. Keys stay server-side.
import type { CollectionItem, CollectionSource } from "./collections.functions";

const IMG = "https://image.tmdb.org/t/p/w342";
const MAX = 250;

export function detectSource(raw: string): { source: CollectionSource; url: URL } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a link. Paste the full list address.");
  }
  const h = url.hostname.replace(/^www\./, "");
  if (h.endsWith("mdblist.com")) return { source: "mdblist", url };
  if (h.endsWith("themoviedb.org")) return { source: "tmdb", url };
  if (h.endsWith("thetvdb.com")) return { source: "tvdb", url };
  if (h.endsWith("trakt.tv")) return { source: "trakt", url };
  throw new Error("Supported links: mdblist.com, themoviedb.org, thetvdb.com and trakt.tv lists.");
}

async function json(u: string | URL, init: RequestInit = {}) {
  const r = await fetch(u, { ...init, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error("That list wasn't found. Make sure it's public.");
  if (r.status === 401 || r.status === 403) throw new Error("That list is private or the service rejected the request.");
  if (!r.ok) throw new Error(`The list service returned an error (${r.status}).`);
  return r.json() as Promise<any>;
}

function tmdbGet(path: string, params: Record<string, string> = {}) {
  const key = process.env["TMDB_API_KEY"];
  if (!key) throw new Error("TMDB isn't set up yet.");
  const bearer = key.length > 60;
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  if (!bearer) u.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return json(u, { headers: bearer ? { Authorization: `Bearer ${key}` } : {} });
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);

function fromTmdb(x: any, forced?: "movie" | "tv"): CollectionItem | null {
  const type = forced ?? (x.media_type === "tv" ? "tv" : x.media_type === "movie" ? "movie" : null);
  if (!type || !x.id) return null;
  return {
    key: `tmdb:${type}:${x.id}`,
    type,
    title: x.title ?? x.name ?? "Unknown",
    year: yearOf(x.release_date ?? x.first_air_date),
    tmdbId: Number(x.id),
    poster: x.poster_path ? `${IMG}${x.poster_path}` : undefined,
  };
}

async function fromTmdbUrl(url: URL) {
  const m = url.pathname.match(/\/(list|collection)\/(\d+)/);
  if (!m) throw new Error("Use a TMDB list or collection link, e.g. themoviedb.org/list/12345.");
  if (m[1] === "collection") {
    const c = await tmdbGet(`/collection/${m[2]}`);
    return {
      name: c.name as string,
      description: (c.overview as string) ?? "",
      items: (c.parts ?? []).map((p: any) => fromTmdb(p, "movie")).filter(Boolean) as CollectionItem[],
    };
  }
  const items: CollectionItem[] = [];
  let name = "TMDB list", description = "";
  for (let page = 1; page <= 10 && items.length < MAX; page++) {
    const l = await tmdbGet(`/list/${m[2]}`, { page: String(page) });
    name = l.name ?? name;
    description = l.description ?? description;
    for (const x of l.items ?? []) {
      const it = fromTmdb(x);
      if (it) items.push(it);
    }
    if (page >= (l.total_pages ?? 1)) break;
  }
  return { name, description, items };
}

async function fromMdblist(url: URL) {
  const path = url.pathname.replace(/\/+$/, "").replace(/\/json$/, "");
  if (!/\/lists\/[^/]+\/[^/]+/.test(path)) throw new Error("Use an MDBList list link, e.g. mdblist.com/lists/user/list-name.");
  const data = await json(`https://mdblist.com${path}/json`);
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? [...(data?.movies ?? []), ...(data?.shows ?? [])]);
  const items = rows
    .map((x): CollectionItem | null => {
      const type = /show|tv|series/i.test(String(x.mediatype ?? x.media_type ?? "")) ? "tv" : "movie";
      const tmdb = Number(x.tmdb_id ?? x.id) || undefined;
      const title = x.title ?? x.name;
      if (!title) return null;
      return {
        key: tmdb ? `tmdb:${type}:${tmdb}` : `mdb:${type}:${title}:${x.release_year ?? ""}`,
        type,
        title,
        year: Number(x.release_year ?? x.year) || undefined,
        tmdbId: tmdb,
        imdbId: x.imdb_id ?? undefined,
      };
    })
    .filter(Boolean) as CollectionItem[];
  const slug = path.split("/").pop() ?? "MDBList";
  return { name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), description: "Imported from MDBList", items };
}

async function fromTrakt(url: URL) {
  const m = url.pathname.match(/\/users\/([^/]+)\/lists\/([^/]+)/);
  if (!m) throw new Error("Use a Trakt list link, e.g. trakt.tv/users/name/lists/list-name.");
  const key = process.env["TRAKT_CLIENT_ID"];
  if (!key) throw new Error("Trakt isn't set up yet.");
  const headers = { "trakt-api-version": "2", "trakt-api-key": key, "Content-Type": "application/json" };
  const base = `https://api.trakt.tv/users/${m[1]}/lists/${m[2]}`;
  const [meta, rows] = await Promise.all([json(base, { headers }).catch(() => ({})), json(`${base}/items/movie,show`, { headers })]);
  const items = (rows as any[])
    .map((r): CollectionItem | null => {
      const t = r.type === "show" ? "tv" : r.type === "movie" ? "movie" : null;
      const o = r.movie ?? r.show;
      if (!t || !o?.title) return null;
      const tmdb = Number(o.ids?.tmdb) || undefined;
      return {
        key: tmdb ? `tmdb:${t}:${tmdb}` : `trakt:${t}:${o.ids?.trakt}`,
        type: t,
        title: o.title,
        year: Number(o.year) || undefined,
        tmdbId: tmdb,
        imdbId: o.ids?.imdb ?? undefined,
      };
    })
    .filter(Boolean) as CollectionItem[];
  return { name: (meta as any).name ?? m[2], description: (meta as any).description ?? "Imported from Trakt", items };
}

async function fromTvdb(url: URL) {
  const m = url.pathname.match(/\/lists\/([^/]+)/);
  if (!m) throw new Error("Use a TVDB list link, e.g. thetvdb.com/lists/list-name.");
  const key = process.env["TVDB_API_KEY"];
  if (!key) throw new Error("TVDB imports need a TVDB API key — it hasn't been added yet.");
  const login = await json("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: key }),
  });
  const headers = { Authorization: `Bearer ${login.data.token}` };
  const api = "https://api4.thetvdb.com/v4";
  const list = /^\d+$/.test(m[1])
    ? await json(`${api}/lists/${m[1]}`, { headers })
    : await json(`${api}/lists/slug/${m[1]}`, { headers });
  const ext = await json(`${api}/lists/${list.data.id}/extended`, { headers });
  const ents: any[] = (ext.data?.entities ?? []).slice(0, 120);
  const items: CollectionItem[] = [];
  for (let i = 0; i < ents.length; i += 10) {
    const got = await Promise.all(
      ents.slice(i, i + 10).map(async (e) => {
        const t = e.seriesId ? "tv" : e.movieId ? "movie" : null;
        if (!t) return null;
        const id = e.seriesId ?? e.movieId;
        const d = await json(`${api}/${t === "tv" ? "series" : "movies"}/${id}`, { headers }).catch(() => null);
        if (!d?.data?.name) return null;
        return {
          key: `tvdb:${t}:${id}`,
          type: t,
          title: d.data.name,
          year: Number(d.data.year) || yearOf(d.data.firstAired) || undefined,
          tvdbId: Number(id),
          poster: d.data.image || undefined,
        } as CollectionItem;
      }),
    );
    for (const g of got) if (g) items.push(g);
  }
  return { name: list.data.name ?? m[1], description: list.data.overview ?? "Imported from TVDB", items };
}

/** Fill missing posters / TMDB ids from TMDB so cards and requests work. */
async function enrich(items: CollectionItem[]) {
  if (!process.env["TMDB_API_KEY"]) return items;
  const todo = items.filter((i) => !i.poster).slice(0, 120);
  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(
      todo.slice(i, i + 10).map(async (it) => {
        try {
          if (it.tmdbId) {
            const d = await tmdbGet(`/${it.type}/${it.tmdbId}`);
            if (d.poster_path) it.poster = `${IMG}${d.poster_path}`;
          } else {
            const s = await tmdbGet(`/search/${it.type}`, {
              query: it.title,
              ...(it.year ? { [it.type === "movie" ? "year" : "first_air_date_year"]: String(it.year) } : {}),
            });
            const r = s.results?.[0];
            if (r) {
              it.tmdbId = r.id;
              if (r.poster_path) it.poster = `${IMG}${r.poster_path}`;
            }
          }
        } catch {
          /* artwork is optional */
        }
      }),
    );
  }
  return items;
}

export async function fetchList(raw: string) {
  const { source, url } = detectSource(raw);
  const r =
    source === "tmdb" ? await fromTmdbUrl(url)
    : source === "mdblist" ? await fromMdblist(url)
    : source === "trakt" ? await fromTrakt(url)
    : await fromTvdb(url);
  const seen = new Set<string>();
  const items = r.items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).slice(0, MAX);
  return { source, name: r.name.slice(0, 120), description: String(r.description ?? "").slice(0, 500), items: await enrich(items) };
}

export async function tmdbSearchItems(q: string): Promise<CollectionItem[]> {
  const s = await tmdbGet("/search/multi", { query: q });
  return ((s.results ?? []) as any[]).map((x) => fromTmdb(x)).filter(Boolean).slice(0, 20) as CollectionItem[];
}
