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

function normalizeMetadata(m: any): any {
  const isFolder = m.type === "show" || m.type === "season" || m.type === "artist" || m.type === "album";
  const runtimeMs = typeof m.duration === "number" ? m.duration : 0;
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
      return { ok: false as const, error: e?.message ?? "Could not reach Plex server" };
    }

    const { addCredential } = await import("./vault.server");
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
