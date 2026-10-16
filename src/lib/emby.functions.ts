// Emby / Jellyfin share the same HTTP API (Jellyfin is a fork). These server
// functions work for both — the `kind` field is informational only.
//
// Access tokens are never accepted from, or returned to, the browser: they are
// stored in the encrypted httpOnly cookie vault and resolved server-side from
// an opaque serverId.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeServerInput } from "./media-client";
import {
  assertSafeServerUrl,
  embyAuthHeader,
  embyFetch,
  normalizeUrl,
  isBareIpHost,
  upstreamBlockMessage,
} from "./media.server";

const serverRef = z.object({ serverId: z.string().min(1).max(100) });

type SiloV2Result =
  | { kind: "ok"; jellyfinUrl: string }
  | { kind: "unsupported" }
  | { kind: "error"; error: string };

/** Sign in through Silo's V2 API and look up its Jellyfin-compatible address. */
async function siloV2Discover(root: string, username: string, password: string): Promise<SiloV2Result> {
  const login = await fetch(`${root}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  }).catch(() => null);
  if (!login) return { kind: "unsupported" };
  const ct = login.headers.get("content-type") ?? "";
  if (!ct.includes("json") || login.status === 404 || login.status === 405) return { kind: "unsupported" };
  if (login.status === 401 || login.status === 403) {
    return { kind: "error", error: "Silo sign-in failed: incorrect username or password." };
  }
  if (!login.ok) {
    const text = await login.text().catch(() => "");
    console.error(`Silo V2 login failed [${login.status}]: ${text.slice(0, 200)}`);
    return { kind: "error", error: `Silo sign-in failed (${login.status}). Try again in a moment.` };
  }
  const pair = (await login.json().catch(() => null)) as { access_token?: string } | null;
  if (!pair?.access_token) return { kind: "error", error: "Silo didn't return a sign-in session." };
  const auth = { Authorization: `Bearer ${pair.access_token}`, Accept: "application/json" };
  try {
    const info = await fetch(`${root}/api/v2/compat/connect-info`, { headers: auth }).catch(() => null);
    const json = (await info?.json().catch(() => null)) as
      | { jellyfin?: { enabled?: boolean; public_url?: string } }
      | null;
    const jf = json?.jellyfin;
    const candidates: string[] = [];
    if (jf?.public_url) candidates.push(new URL(jf.public_url, `${root}/`).toString());
    // Hosted Silo commonly serves Jellyfin on a sibling "<name>-jf" host.
    try {
      const u = new URL(root);
      const [first, ...rest] = u.hostname.split(".");
      if (!isBareIpHost(root) && rest.length && !first.endsWith("-jf")) {
        u.hostname = [`${first}-jf`, ...rest].join(".");
        candidates.push(u.toString());
      }
    } catch {}
    for (const c of candidates) {
      assertSafeServerUrl(c);
      const r = await fetch(`${normalizeUrl(c)}/System/Info/Public`, { headers: { Accept: "application/json" } }).catch(() => null);
      if (r?.ok && (r.headers.get("content-type") ?? "").includes("json")) return { kind: "ok", jellyfinUrl: c };
    }
    if (jf && jf.enabled === false) {
      return {
        kind: "error",
        error:
          "Signed in to Silo, but its Jellyfin compatibility is switched off. Turn it on in Silo's settings (Admin → Jellyfin compatibility), then sign in again.",
      };
    }
    return { kind: "ok", jellyfinUrl: candidates[0] ?? root };
  } finally {
    // We only needed the V2 session for discovery; don't leave it open.
    fetch(`${root}/api/v2/auth/logout`, { method: "POST", headers: auth }).catch(() => null);
  }
}

export const embyLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["emby", "jellyfin", "silo"]),
      serverUrl: z.string().trim().min(1).max(500),
      username: z.string().min(1).max(200),
      password: z.string().max(500),
    }),
  )
  .handler(async ({ data }) => {
    data.serverUrl = normalizeServerInput(data.serverUrl, data.kind);
    assertSafeServerUrl(data.serverUrl);
    let root = normalizeUrl(data.serverUrl);

    // Silo: sign in with Silo's own V2 API first. That accepts the normal Silo
    // website address, verifies the account, and tells us where Silo's
    // Jellyfin-compatible endpoint lives (used for library + playback).
    if (data.kind === "silo") {
      const v2 = await siloV2Discover(root, data.username, data.password);
      if (v2.kind === "error") return { ok: false as const, error: v2.error };
      if (v2.kind === "ok") {
        assertSafeServerUrl(v2.jellyfinUrl);
        root = normalizeUrl(v2.jellyfinUrl);
      }
    }

    // Some servers (notably Silo) serve their web app at the root and expose the
    // Jellyfin-compatible API under a sub-path. Try the root first, then common
    // prefixes, and only accept a real JSON response.
    const bases = [root, `${root}/jellyfin`, `${root}/emby`, `${root}/api`, `${root}/api/jellyfin`];
    let res: Response | null = null;
    let apiBase = root;
    for (const base of bases) {
      const r = await fetch(`${base}/Users/AuthenticateByName`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Emby-Authorization": embyAuthHeader(),
          Authorization: embyAuthHeader(),
        },
        body: JSON.stringify({ Username: data.username, Pw: data.password }),
      }).catch(() => null);
      if (!r) continue;
      const ct = r.headers.get("content-type") ?? "";
      if (r.ok && !ct.includes("json")) continue; // HTML web page, not the API
      if (r.status === 404 || r.status === 405) continue;
      res = r;
      apiBase = base;
      break;
    }
    if (!res) {
      return {
        ok: false as const,
        error:
          data.kind === "silo"
            ? "This address opened Silo's web page, not its Jellyfin connection. Turn on Jellyfin compatibility in Silo's settings and use that address/port."
            : "This address didn't respond like a media server. Check the address and port.",
      };
    }
    if (!res.ok) {
      // Never reflect the upstream body to the caller (SSRF response disclosure).
      const text = await res.text().catch(() => "");
      console.error(`Emby login failed [${res.status}]: ${text.slice(0, 200)}`);
      const blocked = upstreamBlockMessage(res.status, text, data.serverUrl);
      return {
        ok: false as const,
        error:
          blocked ??
          (res.status === 401
            ? "Login failed: incorrect username or password."
            : `Login failed (${res.status}). Check the server address and try again.`),
      };
    }

    let json: { AccessToken: string; User: { Id: string; Name: string } };
    try {
      json = await res.json();
    } catch {
      return { ok: false as const, error: "The server sent an unexpected reply. Check the address and port." };
    }
    if (!json?.AccessToken || !json?.User?.Id) {
      return { ok: false as const, error: "The server didn't return a login session." };
    }
    const { addCredential } = await import("./vault.server");
    const { registerDevice } = await import("./devices.server");
    await registerDevice();

    const server = await addCredential({
      kind: data.kind,
      name: new URL(normalizeUrl(data.serverUrl)).host,
      serverUrl: apiBase,
      token: json.AccessToken,
      userId: json.User.Id,
      userName: json.User.Name,
    });
    return { ok: true as const, server };
  });

// Lightweight reachability check for the sign-in screen: pings the public
// System/Info endpoint (no credentials needed) across the same candidate
// prefixes embyLogin tries, so the user can verify the address before typing
// their username and password.
export const embyTestConnection = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["emby", "jellyfin", "silo"]),
      serverUrl: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    data.serverUrl = normalizeServerInput(data.serverUrl, data.kind);
    assertSafeServerUrl(data.serverUrl);
    const root = normalizeUrl(data.serverUrl);
    const bases = [root, `${root}/jellyfin`, `${root}/emby`, `${root}/api`, `${root}/api/jellyfin`];
    for (const base of bases) {
      const r = await fetch(`${base}/System/Info/Public`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!r || !r.ok) continue;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue; // HTML web page, not the API
      const json = (await r.json().catch(() => null)) as {
        ServerName?: string;
        ProductName?: string;
        Version?: string;
      } | null;
      if (!json || typeof json !== "object") continue;
      return {
        ok: true as const,
        serverName: json.ServerName ?? null,
        productName: json.ProductName ?? null,
        version: json.Version ?? null,
        apiBase: base,
      };
    }
    return {
      ok: false as const,
      error:
        data.kind === "silo"
          ? "That address didn't answer as a Jellyfin-compatible server. Use the Jellyfin-compatible URL from Silo's settings (usually port 8096), not Silo's website address."
          : "That address didn't answer as a media server. Check the address and port.",
    };
  });

export const embyGetViews = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = (await embyFetch(c, `/Users/${c.userId}/Views`)) as {
      Items: Array<{ Id: string; Name: string; CollectionType?: string; ImageTags?: Record<string, string> }>;
    };
    return { views: json.Items ?? [] };
  });

export const embyGetItems = createServerFn({ method: "POST" })
  .inputValidator(
    serverRef.extend({
      parentId: z.string().max(200).optional(),
      includeItemTypes: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(60),
      sortBy: z.string().max(200).default("SortName"),
      sortOrder: z.enum(["Ascending", "Descending"]).default("Ascending"),
      recursive: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      SortBy: data.sortBy,
      SortOrder: data.sortOrder,
      Limit: String(data.limit),
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbImageTag,ParentThumbItemId,SeriesPrimaryImageTag,SeriesId,ImageTags",
      EnableImages: "true",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
    });
    if (data.parentId) params.set("ParentId", data.parentId);
    if (data.includeItemTypes) params.set("IncludeItemTypes", data.includeItemTypes);
    if (data.recursive) params.set("Recursive", "true");
    const json = (await embyFetch(c, `/Users/${c.userId}/Items?${params}`)) as {
      Items: any[];
      TotalRecordCount: number;
    };
    return { items: json.Items ?? [], total: json.TotalRecordCount ?? 0 };
  });

// Full metadata for one item. Emby only returns the richer metadata blocks
// (overview, cast, genres, studios, streams, ratings) when they are requested
// explicitly via Fields — without it, titles whose scrape is thinner come back
// with almost nothing, which is why some copies showed info and others didn't.
const ITEM_FIELDS = [
  "Overview",
  "Taglines",
  "Genres",
  "Studios",
  "People",
  "ProductionYear",
  "PremiereDate",
  "OfficialRating",
  "CommunityRating",
  "CriticRating",
  "ProductionLocations",
  "RunTimeTicks",
  "MediaStreams",
  "MediaSources",
  "Path",
  "SeriesName",
  "SeriesId",
  "SeasonId",
  "ParentIndexNumber",
  "IndexNumber",
  "ChildCount",
  "RecursiveItemCount",
  "PrimaryImageAspectRatio",
  "BackdropImageTags",
  "RemoteTrailers",
  "ExternalUrls",
  "ProviderIds",
  "Chapters",
].join(",");

export const embyGetItem = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      Fields: ITEM_FIELDS,
      EnableImageTypes: "Primary,Backdrop,Thumb,Logo",
    });
    const item = (await embyFetch(
      c,
      `/Users/${c.userId}/Items/${data.itemId}?${params}`,
    )) as any;

    // Fall back to parent metadata so episodes/seasons and thinly-scraped
    // copies still render a synopsis, cast and genres.
    const parentId: string | undefined = item?.SeriesId ?? item?.ParentId;
    const needsFallback =
      item &&
      (!item.Overview ||
        !(item.People?.length) ||
        !(item.Genres?.length));
    if (parentId && needsFallback) {
      try {
        const parent = (await embyFetch(
          c,
          `/Users/${c.userId}/Items/${parentId}?${params}`,
        )) as any;
        if (!item.Overview && parent?.Overview) item.Overview = parent.Overview;
        if (!item.People?.length && parent?.People?.length) item.People = parent.People;
        if (!item.Genres?.length && parent?.Genres?.length) item.Genres = parent.Genres;
        if (!item.Studios?.length && parent?.Studios?.length) item.Studios = parent.Studios;
        if (item.CommunityRating == null && parent?.CommunityRating != null)
          item.CommunityRating = parent.CommunityRating;
        if (!item.OfficialRating && parent?.OfficialRating)
          item.OfficialRating = parent.OfficialRating;
      } catch {
        /* parent unavailable */
      }
    }
    if (item) item.SkipMarkers = embySkipMarkers(item);
    return { item };
  });

/** Intro / credits ranges (seconds) from Emby/Jellyfin chapter markers. */
function embySkipMarkers(item: any) {
  const ch: any[] = Array.isArray(item?.Chapters) ? item.Chapters : [];
  const runtime = item?.RunTimeTicks ? item.RunTimeTicks / 1e7 : 0;
  const out: { kind: "intro" | "credits"; start: number; end: number }[] = [];
  const t = (c: any) => (c?.StartPositionTicks ?? 0) / 1e7;
  let introStart: number | null = null;
  ch.forEach((c, i) => {
    const name = String(c?.Name ?? "").toLowerCase();
    const mt = String(c?.MarkerType ?? "");
    const next = ch[i + 1] ? t(ch[i + 1]) : runtime;
    if (mt === "IntroStart") introStart = t(c);
    else if (mt === "IntroEnd" && introStart != null) {
      out.push({ kind: "intro", start: introStart, end: t(c) });
      introStart = null;
    } else if (mt === "CreditsStart") out.push({ kind: "credits", start: t(c), end: runtime });
    else if (/\b(intro|opening|recap)\b/.test(name) && next > t(c))
      out.push({ kind: "intro", start: t(c), end: next });
    else if (/\b(credits|outro|ending|end credits)\b/.test(name))
      out.push({ kind: "credits", start: t(c), end: runtime || next });
  });
  return out;
}


export const embyGetResume = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      Limit: "20",
      Fields: "PrimaryImageAspectRatio,Overview,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbImageTag,ParentThumbItemId,SeriesPrimaryImageTag,SeriesId,ImageTags",
      MediaTypes: "Video",
      EnableImages: "true",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
    });
    const json = (await embyFetch(c, `/Users/${c.userId}/Items/Resume?${params}`)) as {
      Items: any[];
    };
    return { items: json.Items ?? [] };
  });

export const embyGetLatest = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      Limit: "24",
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbImageTag,ParentThumbItemId,SeriesPrimaryImageTag,SeriesId,ImageTags",
      IncludeItemTypes: "Movie,Series",
      EnableImages: "true",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
      GroupItems: "true",
    });
    const json = (await embyFetch(c, `/Users/${c.userId}/Items/Latest?${params}`)) as
      | any[]
      | { Items: any[] };
    const items = Array.isArray(json) ? json : (json.Items ?? []);
    return { items };
  });

export const embyRefreshLibrary = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const res = await fetch(`${normalizeUrl(c.serverUrl)}/Library/Refresh`, {
      method: "POST",
      headers: {
        "X-Emby-Authorization": embyAuthHeader(c.token, c.userId),
        Authorization: embyAuthHeader(c.token, c.userId),
        "X-Emby-Token": c.token,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`Emby library refresh failed [${res.status}]: ${text.slice(0, 200)}`);
      return {
        ok: false as const,
        error: `Refresh failed (${res.status}).`,
      };
    }

    return { ok: true as const, startedAt: new Date().toISOString() };
  });

export const embySearch = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ query: z.string().max(200) }))
  .handler(async ({ data }) => {
    const q = data.query.trim();
    if (!q) return { items: [] as any[] };
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      SearchTerm: q,
      Recursive: "true",
      Limit: "48",
      IncludeItemTypes: "Movie,Series,Episode",
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear,SeriesName,ParentIndexNumber,IndexNumber,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbImageTag,ParentThumbItemId,SeriesPrimaryImageTag,SeriesId,ImageTags",
      EnableImages: "true",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
    });
    const json = (await embyFetch(c, `/Users/${c.userId}/Items?${params}`)) as { Items: any[] };
    return { items: json.Items ?? [] };
  });

/**
 * Trailers for a movie/series. Two sources:
 *  - local trailer files on the server (playable through /api/public/stream)
 *  - RemoteTrailers metadata (usually YouTube links) — embedded in an iframe
 */
export const embyGetTrailers = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);

    const trailers: Array<
      | { source: "local"; id: string; name: string }
      | { source: "external"; url: string; name: string }
    > = [];

    try {
      const local = (await embyFetch(
        c,
        `/Users/${c.userId}/Items/${data.itemId}/LocalTrailers`,
      )) as any;
      const items: any[] = Array.isArray(local) ? local : (local?.Items ?? []);
      for (const t of items) {
        if (t?.Id) trailers.push({ source: "local", id: String(t.Id), name: t.Name ?? "Trailer" });
      }
    } catch {
      /* server may not expose local trailers */
    }

    try {
      const item = (await embyFetch(c, `/Users/${c.userId}/Items/${data.itemId}`)) as any;
      for (const t of (item?.RemoteTrailers ?? []) as any[]) {
        if (t?.Url) trailers.push({ source: "external", url: t.Url, name: t.Name ?? "Trailer" });
      }
    } catch {
      /* ignore */
    }

    return { trailers };
  });

/**
 * Suggestions built from the viewer's own history: items sharing the genres
 * they watch most, excluding anything already watched.
 */
export const embyGetSuggestions = createServerFn({ method: "POST" })
  .inputValidator(
    serverRef.extend({
      genres: z.array(z.string().max(80)).max(6).default([]),
      excludeIds: z.array(z.string().max(100)).max(60).default([]),
      limit: z.number().int().min(1).max(40).default(24),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);

    async function query(genres: string[]) {
      const params = new URLSearchParams({
        Recursive: "true",
        IncludeItemTypes: "Movie,Series",
        Limit: String(Math.min(60, data.limit * 2)),
        SortBy: "CommunityRating,Random",
        SortOrder: "Descending",
        Fields:
          "PrimaryImageAspectRatio,Overview,ProductionYear,Genres,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbImageTag,ParentThumbItemId,SeriesPrimaryImageTag,SeriesId,ImageTags",
        EnableImages: "true",
        ImageTypeLimit: "1",
        EnableImageTypes: "Primary,Backdrop,Thumb",
      });
      // Emby/Jellyfin treat a pipe-separated Genres list as "any of".
      if (genres.length) params.set("Genres", genres.join("|"));
      const json = (await embyFetch(c, `/Users/${c.userId}/Items?${params}`)) as {
        Items?: any[];
      };
      return json.Items ?? [];
    }

    let items = await query(data.genres);
    // No genre overlap on this server (or no history yet) — fall back to
    // highly-rated titles so the row is still useful.
    if (items.length === 0 && data.genres.length) items = await query([]);

    const skip = new Set(data.excludeIds);
    return {
      items: items.filter((it) => !skip.has(String(it?.Id))).slice(0, data.limit),
    };
  });

// Item counts per library view, used for the Settings statistics list.
// Limit=0 still returns TotalRecordCount, so this is a cheap count query.
export const embyGetViewCounts = createServerFn({ method: "POST" })
  .inputValidator(
    serverRef.extend({
      views: z
        .array(
          z.object({
            id: z.string().min(1).max(100),
            includeItemTypes: z.string().max(200).optional(),
          }),
        )
        .max(60),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const counts: Record<string, number> = {};
    await Promise.all(
      data.views.map(async (v) => {
        const params = new URLSearchParams({
          ParentId: v.id,
          Recursive: "true",
          Limit: "0",
          EnableImages: "false",
          EnableUserData: "false",
        });
        if (v.includeItemTypes) params.set("IncludeItemTypes", v.includeItemTypes);
        try {
          const json = (await embyFetch(c, `/Users/${c.userId}/Items?${params}`)) as {
            TotalRecordCount?: number;
          };
          counts[v.id] = json.TotalRecordCount ?? 0;
        } catch {
          // A single library failing shouldn't blank out every other count.
        }
      }),
    );
    return { counts };
  });

/**
 * "More like this" — Emby/Jellyfin's own similarity engine, with a genre-based
 * fallback for titles the server has no similarity data for.
 */
export const embyGetSimilar = createServerFn({ method: "POST" })
  .inputValidator(
    serverRef.extend({
      itemId: z.string().min(1).max(100),
      limit: z.number().int().min(1).max(30).default(14),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const fields =
      "PrimaryImageAspectRatio,Overview,ProductionYear,Genres,CommunityRating,ImageTags,BackdropImageTags";

    const params = new URLSearchParams({
      UserId: c.userId ?? "",
      Limit: String(data.limit),
      Fields: fields,
      EnableImages: "true",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
    });
    let items: any[] = [];
    try {
      const json = (await embyFetch(c, `/Items/${data.itemId}/Similar?${params}`)) as {
        Items?: any[];
      };
      items = json.Items ?? [];
    } catch {
      items = [];
    }
    return { items: items.slice(0, data.limit) };
  });
