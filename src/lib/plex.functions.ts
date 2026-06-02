// Plex server functions. Plex uses an XML/JSON HTTP API distinct from Emby.
// We normalize responses to the Emby-like shape consumed by the UI:
//   { Id, Name, Type, IsFolder, ProductionYear, Overview, RunTimeTicks,
//     ImageTags: { Primary?, Thumb? }, BackdropImageTags?: [art],
//     IndexNumber? }
// For Plex, ImageTags values are the raw image paths (the URL helpers in
// media-client.ts know how to render them through Plex's photo transcoder).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertSafeExternalUrl } from "./ssrf-guard";

const CLIENT_ID = "lovable-media-web";
const PRODUCT = "LovableMedia";
const VERSION = "1.0.0";
const PLATFORM = "Web";
const DEVICE_NAME = "Browser";

function normalize(url: string) {
  return url.replace(/\/+$/, "");
}

function plexHeaders(token?: string) {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": CLIENT_ID,
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Platform": PLATFORM,
    "X-Plex-Device": PLATFORM,
    "X-Plex-Device-Name": DEVICE_NAME,
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

async function plexFetch(serverUrl: string, path: string, token: string) {
  await assertSafeExternalUrl(serverUrl);
  const url = `${normalize(serverUrl)}${path}${path.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: plexHeaders(token) });
  if (!res.ok) throw new Error(`Plex request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<any>;
}

// Plex login: trade username/password for a token via plex.tv.
// (The user can also paste a token directly — handled in the login UI.)
export const plexLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      username: z.string().min(1).max(200),
      password: z.string().min(1).max(500),
      // Append 2FA code to the password if Plex account requires it.
      verificationCode: z.string().max(20).optional(),
    })
  )
  .handler(async ({ data }) => {
    // Plex v2 sign-in. 2FA is sent by appending the code to the password.
    const password = data.verificationCode
      ? `${data.password}${data.verificationCode}`
      : data.password;
    const body = new URLSearchParams({ login: data.username, password });
    const res = await fetch("https://plex.tv/api/v2/users/signin", {
      method: "POST",
      headers: {
        ...plexHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `Plex login failed (${res.status}).`;
      try {
        const j = JSON.parse(text) as { errors?: { code?: number; message?: string }[] };
        const first = j.errors?.[0];
        if (first?.code === 1029)
          msg = "Plex 2FA is enabled — enter your code in the verification field.";
        else if (first?.message) msg = `Plex: ${first.message}`;
      } catch {
        if (text) msg += ` ${text.slice(0, 200)}`;
      }
      return { ok: false as const, error: msg };
    }
    const json = (await res.json()) as {
      authToken?: string;
      username?: string;
      title?: string;
    };
    if (!json.authToken) return { ok: false as const, error: "Plex did not return a token." };
    return {
      ok: true as const,
      token: json.authToken,
      userName: json.title ?? json.username ?? data.username,
    };
  });

// Verify a server is reachable with the supplied token and resolve its name.
export const plexVerify = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      serverUrl: z.string().url().max(500),
      token: z.string().min(1).max(500),
    })
  )
  .handler(async ({ data }) => {
    try {
      const json = await plexFetch(data.serverUrl, "/", data.token);
      const mc = json.MediaContainer ?? {};
      return {
        ok: true as const,
        machineId: (mc.machineIdentifier as string | undefined) ?? "",
        friendlyName: (mc.friendlyName as string | undefined) ?? new URL(data.serverUrl).host,
      };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Could not reach Plex server" };
    }
  });

const plexSessionSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string(),
});

function normalizeMetadata(serverUrl: string, m: any): any {
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

// Libraries (movies / shows / music sections).
export const plexGetViews = createServerFn({ method: "POST" })
  .inputValidator(plexSessionSchema)
  .handler(async ({ data }) => {
    const json = await plexFetch(data.serverUrl, "/library/sections", data.token);
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
    plexSessionSchema.extend({
      parentId: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(60),
      sortBy: z.string().default("addedAt:desc"),
    })
  )
  .handler(async ({ data }) => {
    if (!data.parentId) return { items: [], total: 0 };
    const sort = data.sortBy.includes(":") ? data.sortBy : "addedAt:desc";
    const json = await plexFetch(
      data.serverUrl,
      `/library/sections/${encodeURIComponent(data.parentId)}/all?X-Plex-Container-Size=${data.limit}&sort=${encodeURIComponent(sort)}`,
      data.token
    );
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    return {
      items: items.map((m) => normalizeMetadata(data.serverUrl, m)),
      total: (json.MediaContainer?.totalSize as number) ?? items.length,
    };
  });

export const plexGetItem = createServerFn({ method: "POST" })
  .inputValidator(plexSessionSchema.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const json = await plexFetch(data.serverUrl, `/library/metadata/${encodeURIComponent(data.itemId)}`, data.token);
    const m = (json.MediaContainer?.Metadata ?? [])[0];
    if (!m) throw new Error("Item not found");
    const item = normalizeMetadata(data.serverUrl, m);
    // For shows/seasons we also fetch children so the UI can render episodes.
    if (item.IsFolder) {
      try {
        const children = await plexFetch(
          data.serverUrl,
          `/library/metadata/${encodeURIComponent(data.itemId)}/children`,
          data.token
        );
        item._children = (children.MediaContainer?.Metadata ?? []).map((c: any) =>
          normalizeMetadata(data.serverUrl, c)
        );
      } catch {
        /* ignore */
      }
    }
    return { item };
  });

export const plexGetResume = createServerFn({ method: "POST" })
  .inputValidator(plexSessionSchema)
  .handler(async ({ data }) => {
    const json = await plexFetch(data.serverUrl, "/library/onDeck", data.token);
    const items = (json.MediaContainer?.Metadata ?? []) as any[];
    return { items: items.map((m) => normalizeMetadata(data.serverUrl, m)) };
  });

// Trigger a full library refresh across all sections.
export const plexRefreshLibrary = createServerFn({ method: "POST" })
  .inputValidator(plexSessionSchema)
  .handler(async ({ data }) => {
    try {
      // Refresh every section; Plex doesn't have a single global endpoint.
      const sections = await plexFetch(data.serverUrl, "/library/sections", data.token);
      const dirs = (sections.MediaContainer?.Directory ?? []) as any[];
      await Promise.all(
        dirs.map((d) =>
          fetch(
            `${normalize(data.serverUrl)}/library/sections/${encodeURIComponent(String(d.key))}/refresh?X-Plex-Token=${encodeURIComponent(data.token)}`,
            { headers: plexHeaders(data.token) }
          ).catch(() => null)
        )
      );
      return { ok: true as const, startedAt: new Date().toISOString() };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Refresh failed" };
    }
  });

// Resolve a direct-play URL for an item (returns the Part.key path).
export const plexGetStreamInfo = createServerFn({ method: "POST" })
  .inputValidator(plexSessionSchema.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const json = await plexFetch(data.serverUrl, `/library/metadata/${encodeURIComponent(data.itemId)}`, data.token);
    const m = (json.MediaContainer?.Metadata ?? [])[0];
    const part = m?.Media?.[0]?.Part?.[0];
    if (!part?.key) return { ok: false as const, error: "No playable media on this item." };
    return { ok: true as const, partKey: part.key as string, container: (part.container as string) ?? "mp4" };
  });
