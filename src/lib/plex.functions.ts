// Plex server functions. Plex uses an XML/JSON HTTP API distinct from Emby.
// We normalize responses to the Emby-like shape consumed by the UI:
//   { Id, Name, Type, IsFolder, ProductionYear, Overview, RunTimeTicks,
//     ImageTags: { Primary?, Thumb? }, BackdropImageTags?: [art],
//     IndexNumber? }
// For Plex, ImageTags values are the raw image paths (the URL helpers in
// media-client.ts know how to render them through the media proxy).
//
// The X-Plex-Token never reaches the browser: it is stored in the encrypted
// httpOnly cookie vault and resolved server-side from an opaque serverId.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeUrl, plexFetch, plexHeaders, plexRequest } from "./media.server";

const serverRef = z.object({ serverId: z.string().min(1).max(100) });

function tags(list: any): string[] {
  return Array.isArray(list) ? list.map((t: any) => t?.tag).filter(Boolean) : [];
}

function plexPeople(m: any): any[] {
  const people: any[] = [];
  const push = (list: any, type: string) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (!p?.tag) continue;
      people.push({
        Id: String(p.id ?? p.tag),
        Name: p.tag,
        Type: type,
        Role: p.role ?? undefined,
        PrimaryImageTag: p.thumb ?? undefined,
      });
    }
  };
  push(m.Role, "Actor");
  push(m.Director, "Director");
  push(m.Writer, "Writer");
  push(m.Producer, "Producer");
  return people;
}

function plexStreams(m: any): any[] {
  const media = Array.isArray(m.Media) ? m.Media : [];
  const out: any[] = [];
  let index = 0;
  for (const md of media) {
    const parts = Array.isArray(md.Part) ? md.Part : [];
    for (const part of parts) {
      const streams = Array.isArray(part.Stream) ? part.Stream : [];
      for (const s of streams) {
        out.push({
          Index: index++,
          Type: s.streamType === 1 ? "Video" : s.streamType === 2 ? "Audio" : "Subtitle",
          Codec: s.codec,
          Width: s.width ?? md.width,
          Height: s.height ?? md.height,
          BitDepth: s.bitDepth,
          AverageFrameRate: typeof md.videoFrameRate === "string" ? undefined : md.frameRate,
          VideoRange: s.colorTrc === "smpte2084" ? "HDR" : undefined,
          ChannelLayout: s.audioChannelLayout,
          Language: s.language,
          DisplayTitle: s.displayTitle ?? s.extendedDisplayTitle,
        });
      }
    }
  }
  return out;
}

function normalizeMetadata(m: any): any {
  const isFolder = m.type === "show" || m.type === "season" || m.type === "artist" || m.type === "album";
  const runtimeMs = typeof m.duration === "number" ? m.duration : 0;
  const streams = plexStreams(m);
  const container = m.Media?.[0]?.Part?.[0]?.container ?? m.Media?.[0]?.container;
  return {
    Id: String(m.ratingKey ?? m.key ?? ""),
    Name: m.title ?? m.parentTitle ?? "Untitled",
    Type:
      m.type === "movie" ? "Movie"
      : m.type === "show" ? "Series"
      : m.type === "season" ? "Season"
      : m.type === "episode" ? "Episode"
      : m.type ?? "Item",
    IsFolder: isFolder,
    ProductionYear: m.year,
    Overview: m.summary,
    Taglines: m.tagline ? [m.tagline] : undefined,
    OfficialRating: m.contentRating,
    CommunityRating: typeof m.rating === "number" ? m.rating : undefined,
    CriticRating:
      typeof m.audienceRating === "number" ? Math.round(m.audienceRating * 10) : undefined,
    PremiereDate: m.originallyAvailableAt,
    Genres: tags(m.Genre),
    Studios: m.studio ? [{ Name: m.studio }] : tags(m.Studio).map((n) => ({ Name: n })),
    People: plexPeople(m),
    Status: m.status,
    ChildCount: m.childCount,
    RecursiveItemCount: m.leafCount,
    SeriesName: m.grandparentTitle ?? (m.type === "episode" ? m.parentTitle : undefined),
    ParentIndexNumber: m.parentIndex,
    MediaStreams: streams,
    MediaSources: streams.length ? [{ Container: container, MediaStreams: streams }] : undefined,
    RunTimeTicks: runtimeMs * 10_000, // ms → 100ns ticks
    IndexNumber: m.index,
    ImageTags: {
      Primary: m.thumb ?? m.parentThumb ?? m.grandparentThumb,
      Thumb: m.thumb ?? m.art,
    },
    BackdropImageTags: m.art ? [m.art] : undefined,
    // Carry through media parts so the watch page can resolve a direct stream
    // without a second round-trip.
    _plexParts: Array.isArray(m.Media)
      ? m.Media.flatMap((md: any) =>
          Array.isArray(md.Part) ? md.Part.map((p: any) => ({ key: p.key, container: p.container })) : []
        )
      : undefined,
  };
}


/**
 * Connect a Plex server. Either plex.tv credentials or a pasted token is
 * accepted; both are exchanged/verified here and stored server-side. The
 * response contains no token.
 */
export const plexAddServer = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      serverUrl: z.string().url().max(500),
      username: z.string().max(200).optional(),
      password: z.string().max(500).optional(),
      token: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    let token = data.token?.trim() ?? "";
    let userName = data.username?.trim() || "Plex user";

    if (!token) {
      if (!data.username || !data.password) {
        return { ok: false as const, error: "Plex username and password are required." };
      }
      const body = new URLSearchParams({
        "user[login]": data.username,
        "user[password]": data.password,
      });
      const res = await fetch("https://plex.tv/users/sign_in.json", {
        method: "POST",
        headers: { ...plexHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `Plex login failed (${res.status}). ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        user?: { authToken?: string; authentication_token?: string; username?: string; title?: string };
      };
      token = json.user?.authToken ?? json.user?.authentication_token ?? "";
      if (!token) return { ok: false as const, error: "Plex did not return a token." };
      userName = json.user?.title ?? json.user?.username ?? userName;
    }

    // Verify the server is reachable with this token before storing it.
    let machineId = "";
    let friendlyName = new URL(normalizeUrl(data.serverUrl)).host;
    try {
      const info = await plexRequest(data.serverUrl, "/", token);
      const mc = info.MediaContainer ?? {};
      machineId = (mc.machineIdentifier as string | undefined) ?? "";
      friendlyName = (mc.friendlyName as string | undefined) ?? friendlyName;
    } catch (e: any) {
      const raw = String(e?.message ?? "");
      const blocked = upstreamBlockMessage(/403/.test(raw) ? 403 : 0, raw, data.serverUrl);
      return { ok: false as const, error: blocked ?? raw ?? "Could not reach Plex server" };
    }


    const { addCredential, readVault } = await import("./vault.server");
    const { callerHasPro } = await import("./entitlements.server");
    const { registerDevice } = await import("./devices.server");
    const { serverLimitFor, SERVER_LIMIT_ERROR, DEVICE_LIMIT_ERROR } = await import("./limits");
    const isPro = await callerHasPro();
    const existing = await readVault();
    // Same address + same account = re-login (replaces the old credential);
    // a different account is a new connection and counts against the limit.
    const alreadyConnected = existing.some(
      (c) => c.serverUrl.replace(/\/+$/, "") === normalizeUrl(data.serverUrl) && c.userName === userName,
    );
    if (!alreadyConnected && existing.length >= serverLimitFor(isPro)) {
      return { ok: false as const, error: SERVER_LIMIT_ERROR, limitReached: true as const };
    }
    const device = await registerDevice(isPro);
    if (!device.allowed) {
      return { ok: false as const, error: DEVICE_LIMIT_ERROR, limitReached: true as const };
    }

    const server = await addCredential({
      kind: "plex",
      name: friendlyName,
      serverUrl: data.serverUrl,
      token,
      userId: machineId,
      userName,
    });
    return { ok: true as const, server };
  });

// Libraries (movies / shows / music sections).
export const plexGetViews = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(c, "/library/sections");
    const dirs = (json.MediaContainer?.Directory ?? []) as any[];
    return {
      views: dirs.map((d) => ({
        Id: String(d.key),
        Name: d.title as string,
        CollectionType: d.type as string | undefined,
        ImageTags: {} as Record<string, string>,
      })),
    };
  });

export const plexGetItems = createServerFn({ method: "POST" })
  .inputValidator(
    serverRef.extend({
      parentId: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(60),
      sortBy: z.string().max(200).default("addedAt:desc"),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.parentId) return { items: [], total: 0 };
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const sort = data.sortBy.includes(":") ? data.sortBy : "addedAt:desc";
    const json = await plexFetch(
      c,
      `/library/sections/${encodeURIComponent(data.parentId)}/all?X-Plex-Container-Size=${data.limit}&sort=${encodeURIComponent(sort)}`,
    );
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    return {
      items: items.map((m) => normalizeMetadata(m)),
      total: (json.MediaContainer?.totalSize as number) ?? items.length,
    };
  });

export const plexGetItem = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(c, `/library/metadata/${encodeURIComponent(data.itemId)}`);
    const m = (json.MediaContainer?.Metadata ?? [])[0];
    if (!m) throw new Error("Item not found");
    const item = normalizeMetadata(m);
    // For shows/seasons we also fetch children so the UI can render episodes.
    if (item.IsFolder) {
      try {
        const children = await plexFetch(
          c,
          `/library/metadata/${encodeURIComponent(data.itemId)}/children`,
        );
        item._children = (children.MediaContainer?.Metadata ?? []).map((child: any) =>
          normalizeMetadata(child),
        );
      } catch {
        /* ignore */
      }
    }
    return { item };
  });

export const plexGetResume = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(c, "/library/onDeck");
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    return { items: items.map((m) => normalizeMetadata(m)) };
  });

export const plexGetLatest = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(c, "/library/recentlyAdded?X-Plex-Container-Size=24");
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    // Prefer movies and shows; collapse episodes up to their show.
    const mapped = items
      .filter((m) => m.type === "movie" || m.type === "show" || m.type === "season" || m.type === "episode")
      .map((m) => normalizeMetadata(m));
    return { items: mapped };
  });

// Trigger a full library refresh across all sections.
export const plexRefreshLibrary = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    try {
      // Refresh every section; Plex doesn't have a single global endpoint.
      const sections = await plexFetch(c, "/library/sections");
      const dirs = (sections.MediaContainer?.Directory ?? []) as any[];
      await Promise.all(
        dirs.map((d) =>
          fetch(
            `${normalizeUrl(c.serverUrl)}/library/sections/${encodeURIComponent(String(d.key))}/refresh`,
            { headers: plexHeaders(c.token) },
          ).catch(() => null),
        ),
      );
      return { ok: true as const, startedAt: new Date().toISOString() };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Refresh failed" };
    }
  });

// Resolve a direct-play path for an item (returns the Part.key path, which the
// media proxy will authenticate server-side).
export const plexGetStreamInfo = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(c, `/library/metadata/${encodeURIComponent(data.itemId)}`);
    const m = (json.MediaContainer?.Metadata ?? [])[0];
    const part = m?.Media?.[0]?.Part?.[0];
    if (!part?.key) return { ok: false as const, error: "No playable media on this item." };
    return { ok: true as const, partKey: part.key as string, container: (part.container as string) ?? "mp4" };
  });

export const plexSearch = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ query: z.string().max(200) }))
  .handler(async ({ data }) => {
    const q = data.query.trim();
    if (!q) return { items: [] as any[] };
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const json = await plexFetch(
      c,
      `/search?query=${encodeURIComponent(q)}&X-Plex-Container-Size=48`,
    );
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    return {
      items: items
        .filter((m) => m.type === "movie" || m.type === "show" || m.type === "episode")
        .map((m) => normalizeMetadata(m)),
    };
  });

/**
 * Plex trailers/extras. Plex stores them as child "clip" items with their own
 * Media parts, so they stream through the media proxy just like a full title.
 */
export const plexGetTrailers = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const trailers: Array<
      | { source: "part"; partKey: string; name: string }
      | { source: "external"; url: string; name: string }
    > = [];
    try {
      const json = await plexFetch(
        c,
        `/library/metadata/${encodeURIComponent(data.itemId)}?includeExtras=1`,
      );
      const m = (json.MediaContainer?.Metadata ?? [])[0];
      const extras: any[] = m?.Extras?.Metadata ?? [];
      for (const e of extras) {
        const isTrailer = e?.subtype === "trailer" || e?.extraType === 1 || extras.length > 0;
        if (!isTrailer) continue;
        const part = e?.Media?.[0]?.Part?.[0];
        const name = e?.title ?? "Trailer";
        if (part?.key) trailers.push({ source: "part", partKey: String(part.key), name });
        else if (typeof e?.url === "string" && e.url.startsWith("http"))
          trailers.push({ source: "external", url: e.url, name });
      }
    } catch {
      /* extras unavailable */
    }
    return { trailers };
  });
