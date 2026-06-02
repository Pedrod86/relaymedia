// Emby / Jellyfin share the same HTTP API (Jellyfin is a fork). These server
// functions work for both — the `kind` field is informational only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertSafeExternalUrl } from "./ssrf-guard";

const CLIENT_NAME = "LovableMedia";
const DEVICE_NAME = "Web Browser";
const APP_VERSION = "1.0.0";

function authHeader(token?: string, userId?: string, deviceId = "lovable-media-web") {
  const parts = [
    `MediaBrowser Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId}"`,
    `Version="${APP_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  if (userId) parts.push(`UserId="${userId}"`);
  return parts.join(", ");
}

function normalize(url: string) {
  return url.replace(/\/+$/, "");
}

export const embyLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      serverUrl: z.string().url().max(500),
      username: z.string().min(1).max(200),
      password: z.string().max(500),
    })
  )
  .handler(async ({ data }) => {
    try { await assertSafeExternalUrl(data.serverUrl); } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Server URL not allowed" };
    }
    const url = `${normalize(data.serverUrl)}/Users/AuthenticateByName`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": authHeader(),
        // Jellyfin prefers the Authorization header but accepts X-Emby-Authorization.
        Authorization: authHeader(),
      },
      body: JSON.stringify({ Username: data.username, Pw: data.password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false as const, error: `Login failed (${res.status}). ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      AccessToken: string;
      User: { Id: string; Name: string };
      ServerId?: string;
    };
    return {
      ok: true as const,
      token: json.AccessToken,
      userId: json.User.Id,
      userName: json.User.Name,
      serverId: json.ServerId,
    };
  });

const sessionSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string(),
  userId: z.string(),
});

async function embyFetch(serverUrl: string, path: string, token: string, userId: string) {
  const res = await fetch(`${normalize(serverUrl)}${path}`, {
    headers: {
      "X-Emby-Authorization": authHeader(token, userId),
      Authorization: authHeader(token, userId),
      "X-Emby-Token": token,
    },
  });
  if (!res.ok) {
    throw new Error(`Server request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const embyGetViews = createServerFn({ method: "POST" })
  .inputValidator(sessionSchema)
  .handler(async ({ data }) => {
    const json = (await embyFetch(
      data.serverUrl,
      `/Users/${data.userId}/Views`,
      data.token,
      data.userId
    )) as { Items: Array<{ Id: string; Name: string; CollectionType?: string; ImageTags?: Record<string, string> }> };
    return { views: json.Items ?? [] };
  });

export const embyGetItems = createServerFn({ method: "POST" })
  .inputValidator(
    sessionSchema.extend({
      parentId: z.string().optional(),
      includeItemTypes: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(60),
      sortBy: z.string().default("SortName"),
      recursive: z.boolean().default(false),
    })
  )
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      SortBy: data.sortBy,
      SortOrder: "Ascending",
      Limit: String(data.limit),
      Fields:
        "PrimaryImageAspectRatio,Overview,ProductionYear,RunTimeTicks,OfficialRating,CommunityRating,Genres,Studios,SeriesName,SeriesId,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,MediaSources,Width,Height,Path,DateCreated",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb,Banner,Logo",
      EnableTotalRecordCount: "true",
    });
    if (data.parentId) params.set("ParentId", data.parentId);
    if (data.includeItemTypes) params.set("IncludeItemTypes", data.includeItemTypes);
    if (data.recursive) params.set("Recursive", "true");
    const json = (await embyFetch(
      data.serverUrl,
      `/Users/${data.userId}/Items?${params}`,
      data.token,
      data.userId
    )) as { Items: any[]; TotalRecordCount: number };
    return { items: json.Items ?? [], total: json.TotalRecordCount ?? 0 };
  });

export const embyGetItem = createServerFn({ method: "POST" })
  .inputValidator(sessionSchema.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const item = (await embyFetch(
      data.serverUrl,
      `/Users/${data.userId}/Items/${data.itemId}`,
      data.token,
      data.userId
    )) as any;
    return { item };
  });

export const embyGetResume = createServerFn({ method: "POST" })
  .inputValidator(sessionSchema)
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      Limit: "20",
      Fields:
        "PrimaryImageAspectRatio,Overview,ProductionYear,RunTimeTicks,SeriesName,SeriesId,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,Width,Height",
      MediaTypes: "Video",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb,Banner,Logo",
    });
    const json = (await embyFetch(
      data.serverUrl,
      `/Users/${data.userId}/Items/Resume?${params}`,
      data.token,
      data.userId
    )) as { Items: any[] };
    return { items: json.Items ?? [] };
  });

export const embyRefreshLibrary = createServerFn({ method: "POST" })
  .inputValidator(sessionSchema)
  .handler(async ({ data }) => {
    const res = await fetch(`${normalize(data.serverUrl)}/Library/Refresh`, {
      method: "POST",
      headers: {
        "X-Emby-Authorization": authHeader(data.token, data.userId),
        Authorization: authHeader(data.token, data.userId),
        "X-Emby-Token": data.token,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false as const,
        error: `Refresh failed (${res.status}). ${text.slice(0, 200)}`,
      };
    }
    return { ok: true as const, startedAt: new Date().toISOString() };
  });
