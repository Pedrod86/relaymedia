// Overseerr / Jellyseerr: search TMDB through the user's request server and
// ask for movies/shows to be added. The API key never leaves the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type RequestsStatus =
  | { connected: false }
  | { connected: true; host: string; version: string; keyHint: string };

export type SeerrResult = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string;
  overview: string;
  poster: string | null;
  /** 1 unknown, 2 pending, 3 processing, 4 partly available, 5 available */
  status: number;
};

export type SeerrRequest = {
  id: number;
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  poster: string | null;
  /** request status: 1 pending approval, 2 approved, 3 declined */
  requestStatus: number;
  mediaStatus: number;
  createdAt: string;
};

const IMG = "https://image.tmdb.org/t/p/w342";

function friendly(e: unknown) {
  const m = String((e as any)?.message ?? e);
  if (m === "SEERR_BAD_KEY") return "That API key was rejected. Copy it again from Settings > General in Overseerr/Jellyseerr.";
  if (m === "SEERR_NOT_JSON") return "That address isn't an Overseerr or Jellyseerr server. Check the address and port (usually 5055).";
  if (m === "REQ_NOT_CONNECTED") return "Connect Overseerr or Jellyseerr in Settings > Integrations first.";
  if (/fetch failed|timeout|abort|ENOTFOUND|ECONN/i.test(m))
    return "Couldn't reach that server. Make sure it's reachable from the internet (home addresses like 192.168.x won't work).";
  return m;
}

async function need() {
  const { readRequests } = await import("./requests.server");
  const c = await readRequests();
  if (!c) throw new Error("REQ_NOT_CONNECTED");
  return c;
}

export const requestsStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestsStatus> => {
    const { readRequests } = await import("./requests.server");
    const c = await readRequests();
    if (!c) return { connected: false };
    return { connected: true, host: new URL(c.url).host, version: c.version, keyHint: `••••${c.apiKey.slice(-4)}` };
  },
);

export const requestsConnect = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: z.string().trim().min(3).max(300), apiKey: z.string().trim().min(10).max(200) }))
  .handler(async ({ data }) => {
    const { seerr, writeRequests } = await import("./requests.server");
    const { assertSafeServerUrl } = await import("./media.server");
    try {
      let url = data.url.replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url)) url = `${/:\d+$/.test(url) ? "http" : "https"}://${url}`;
      if (!/:\d+$/.test(new URL(url).host) && url.startsWith("http://")) url += ":5055";
      assertSafeServerUrl(url);
      const cred = { url, apiKey: data.apiKey };
      const st = await seerr<{ version?: string }>(cred, "/status");
      await seerr(cred, "/settings/main"); // proves the key works
      await writeRequests({ ...cred, version: st.version ?? "", connectedAt: new Date().toISOString() });
      return { ok: true as const, host: new URL(url).host, version: st.version ?? "" };
    } catch (e) {
      return { ok: false as const, error: friendly(e) };
    }
  });

export const requestsDisconnect = createServerFn({ method: "POST" }).handler(async () => {
  const { writeRequests } = await import("./requests.server");
  await writeRequests(null);
  return { ok: true as const };
});

export const requestsSearch = createServerFn({ method: "POST" })
  .inputValidator(z.object({ query: z.string().trim().max(120) }))
  .handler(async ({ data }) => {
    try {
      const c = await need();
      const { seerr } = await import("./requests.server");
      const path = data.query
        ? `/search?query=${encodeURIComponent(data.query)}&page=1`
        : `/discover/trending?page=1`;
      const r = await seerr<{ results: any[] }>(c, path);
      const results: SeerrResult[] = (r.results ?? [])
        .filter((x) => x.mediaType === "movie" || x.mediaType === "tv")
        .map((x) => ({
          id: x.id,
          mediaType: x.mediaType,
          title: x.title ?? x.name ?? "Untitled",
          year: String(x.releaseDate ?? x.firstAirDate ?? "").slice(0, 4),
          overview: x.overview ?? "",
          poster: x.posterPath ? `${IMG}${x.posterPath}` : null,
          status: x.mediaInfo?.status ?? 1,
        }));
      return { ok: true as const, results };
    } catch (e) {
      return { ok: false as const, error: friendly(e), results: [] as SeerrResult[] };
    }
  });

export const requestsCreate = createServerFn({ method: "POST" })
  .inputValidator(z.object({ mediaType: z.enum(["movie", "tv"]), mediaId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    try {
      const c = await need();
      const { seerr } = await import("./requests.server");
      await seerr(c, "/request", {
        method: "POST",
        body: { mediaType: data.mediaType, mediaId: data.mediaId, ...(data.mediaType === "tv" ? { seasons: "all" } : {}) },
      });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: friendly(e) };
    }
  });

export const requestsList = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const c = await need();
    const { seerr } = await import("./requests.server");
    const r = await seerr<{ results: any[] }>(c, "/request?take=24&skip=0&sort=added");
    const items = await Promise.all(
      (r.results ?? []).map(async (q): Promise<SeerrRequest> => {
        const type = q.type === "tv" ? "tv" : "movie";
        const tmdbId = q.media?.tmdbId;
        let title = "Unknown title";
        let poster: string | null = null;
        try {
          const d = await seerr<any>(c, `/${type}/${tmdbId}`);
          title = d.title ?? d.name ?? title;
          poster = d.posterPath ? `${IMG}${d.posterPath}` : null;
        } catch {}
        return {
          id: q.id,
          mediaType: type,
          tmdbId,
          title,
          poster,
          requestStatus: q.status ?? 1,
          mediaStatus: q.media?.status ?? 1,
          createdAt: q.createdAt ?? "",
        };
      }),
    );
    return { ok: true as const, items };
  } catch (e) {
    return { ok: false as const, error: friendly(e), items: [] as SeerrRequest[] };
  }
});
