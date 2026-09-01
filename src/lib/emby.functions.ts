// Emby / Jellyfin share the same HTTP API (Jellyfin is a fork). These server
// functions work for both — the `kind` field is informational only.
//
// Access tokens are never accepted from, or returned to, the browser: they are
// stored in the encrypted httpOnly cookie vault and resolved server-side from
// an opaque serverId.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  assertSafeServerUrl,
  embyAuthHeader,
  embyFetch,
  normalizeUrl,
  upstreamBlockMessage,
} from "./media.server";

const serverRef = z.object({ serverId: z.string().min(1).max(100) });

export const embyLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["emby", "jellyfin"]),
      serverUrl: z.string().url().max(500),
      username: z.string().min(1).max(200),
      password: z.string().max(500),
    }),
  )
  .handler(async ({ data }) => {
    assertSafeServerUrl(data.serverUrl);
    const url = `${normalizeUrl(data.serverUrl)}/Users/AuthenticateByName`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": embyAuthHeader(),
        // Jellyfin prefers the Authorization header but accepts X-Emby-Authorization.
        Authorization: embyAuthHeader(),
      },
      body: JSON.stringify({ Username: data.username, Pw: data.password }),
    });
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


    const json = (await res.json()) as {
      AccessToken: string;
      User: { Id: string; Name: string };
    };
    const { addCredential, readVault } = await import("./vault.server");
    const { callerHasPro } = await import("./entitlements.server");
    const { registerDevice } = await import("./devices.server");
    const { serverLimitFor, SERVER_LIMIT_ERROR, DEVICE_LIMIT_ERROR } = await import("./limits");
    const isPro = await callerHasPro();
    const existing = await readVault();
    // Only a re-login of the SAME server + SAME user replaces an existing entry.
    // A different account on the same address adds a new connection, so it must
    // still count against the plan limit.
    const alreadyConnected = existing.some(
      (c) =>
        c.serverUrl.replace(/\/+$/, "") === normalizeUrl(data.serverUrl) &&
        c.userName === json.User.Name,
    );
    if (!alreadyConnected && existing.length >= serverLimitFor(isPro)) {
      return { ok: false as const, error: SERVER_LIMIT_ERROR, limitReached: true as const };
    }
    const device = await registerDevice(isPro);
    if (!device.allowed) {
      return { ok: false as const, error: DEVICE_LIMIT_ERROR, limitReached: true as const };
    }

    const server = await addCredential({
      kind: data.kind,
      name: new URL(normalizeUrl(data.serverUrl)).host,
      serverUrl: data.serverUrl,
      token: json.AccessToken,
      userId: json.User.Id,
      userName: json.User.Name,
    });
    return { ok: true as const, server };
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
      recursive: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      SortBy: data.sortBy,
      SortOrder: "Ascending",
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
  "ParentIndexNumber",
  "IndexNumber",
  "ChildCount",
  "RecursiveItemCount",
  "PrimaryImageAspectRatio",
  "BackdropImageTags",
  "RemoteTrailers",
  "ExternalUrls",
  "ProviderIds",
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
    return { item };
  });


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
