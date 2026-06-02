// Emby / Jellyfin share the same HTTP API (Jellyfin is a fork). These server
// functions work for both — the `kind` field is informational only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertSafeExternalUrl } from "./ssrf-guard";

const CLIENT_NAME = "LovableMedia";
const DEVICE_NAME = "Web Browser";
const APP_VERSION = "1.0.0";
const USER_AGENT = "RelayMedia/1.0";

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

function embyHeaders(token?: string, userId?: string, contentType?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    "X-RelayMedia-Client": USER_AGENT,
    Authorization: authHeader(token, userId),
    "X-Emby-Authorization": authHeader(token, userId),
    "X-MediaBrowser-Authorization": authHeader(token, userId),
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (token) {
    headers["X-Emby-Token"] = token;
    headers["X-MediaBrowser-Token"] = token;
  }
  return headers;
}

function normalize(url: string) {
  return url.replace(/\/+$/, "");
}

function networkLoginError(error: unknown) {
  const message = error instanceof Error ? error.message : "fetch failed";
  if (/fetch failed|network|timed out|abort/i.test(message)) {
    return "The app can’t reach your Emby/Jellyfin server from the live site. Use a real public HTTPS hostname for your media server and allow requests from RelayMedia/1.0 in your proxy/firewall.";
  }
  return message;
}

function embyLoginError(status: number, bodyText: string) {
  const clean = bodyText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();

  if (status === 403 && (lower.includes("error code: 1003") || lower.includes("error 1003"))) {
    return "Emby/Jellyfin rejected the live app with 403 / 1003. This usually means remote access is disabled for the server or this user, or your proxy/firewall blocks the published app’s outbound request. In Emby, enable remote connections for the server and for this user, then allow RelayMedia/1.0 through your proxy/firewall.";
  }
  if (status === 403 && /not allowed access from this device|deviceaccessdenied/i.test(clean)) {
    return "This Emby/Jellyfin user is not allowed to sign in from this device. Allow this app/device in your server user access settings, then try again.";
  }
  if (status === 403 && /maximum number of sessions|maxconcurrentsessions/i.test(clean)) {
    return "This Emby/Jellyfin user has reached the maximum number of sessions. Remove an old session/device in your server dashboard, then try again.";
  }
  if (status === 401 || /invalid username or password|invalidusernameorpassword/i.test(clean)) {
    return "Invalid Emby/Jellyfin username or password.";
  }

  return `Login failed (${status}). ${clean.slice(0, 200)}`;
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
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: embyHeaders(undefined, undefined, "application/json"),
        body: JSON.stringify({ Username: data.username.trim(), Pw: data.password }),
      });
    } catch (e) {
      return { ok: false as const, error: networkLoginError(e) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false as const, error: embyLoginError(res.status, text) };
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

export const embyApiKeyLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      serverUrl: z.string().url().max(500),
      apiKey: z.string().min(8).max(2000),
      username: z.string().max(200).optional(),
    })
  )
  .handler(async ({ data }) => {
    try { await assertSafeExternalUrl(data.serverUrl); } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Server URL not allowed" };
    }
    const apiKey = data.apiKey.trim();
    const wanted = data.username?.trim().toLowerCase();
    let res: Response;
    try {
      res = await fetch(`${normalize(data.serverUrl)}/Users?api_key=${encodeURIComponent(apiKey)}`, {
        headers: embyHeaders(apiKey),
      });
    } catch (e) {
      return { ok: false as const, error: networkLoginError(e) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false as const,
        error: `API key login failed (${res.status}). ${text.replace(/<[^>]*>/g, " ").slice(0, 200)}`,
      };
    }
    const users = (await res.json()) as Array<{ Id: string; Name: string; Policy?: { IsDisabled?: boolean } }>;
    const enabled = users.filter((u) => !u.Policy?.IsDisabled);
    const user = wanted
      ? enabled.find((u) => u.Name.toLowerCase() === wanted)
      : enabled[0];
    if (!user) {
      return {
        ok: false as const,
        error: wanted ? "API key works, but that username was not found." : "API key works, but no enabled users were returned.",
      };
    }
    return {
      ok: true as const,
      token: apiKey,
      userId: user.Id,
      userName: user.Name,
    };
  });

const sessionSchema = z.object({
  serverUrl: z.string().url().max(500),
  token: z.string().max(2000),
  userId: z.string().max(200),
});

async function embyFetch(serverUrl: string, path: string, token: string, userId: string) {
  await assertSafeExternalUrl(serverUrl);
  const res = await fetch(`${normalize(serverUrl)}${path}`, {
    headers: embyHeaders(token, userId),
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
    try { await assertSafeExternalUrl(data.serverUrl); } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Server URL not allowed" };
    }
    const res = await fetch(`${normalize(data.serverUrl)}/Library/Refresh`, {
      method: "POST",
      headers: embyHeaders(data.token, data.userId),
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

// Refresh metadata + images for a single item. `replace` controls whether
// existing data is overwritten or only missing fields filled in.
export const embyRefreshItem = createServerFn({ method: "POST" })
  .inputValidator(
    sessionSchema.extend({
      itemId: z.string().min(1).max(100),
      replace: z.boolean().default(false),
      recursive: z.boolean().default(true),
    })
  )
  .handler(async ({ data }) => {
    try { await assertSafeExternalUrl(data.serverUrl); } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Server URL not allowed" };
    }
    const params = new URLSearchParams({
      Recursive: data.recursive ? "true" : "false",
      MetadataRefreshMode: "FullRefresh",
      ImageRefreshMode: "FullRefresh",
      ReplaceAllMetadata: data.replace ? "true" : "false",
      ReplaceAllImages: data.replace ? "true" : "false",
    });
    const res = await fetch(
      `${normalize(data.serverUrl)}/Items/${encodeURIComponent(data.itemId)}/Refresh?${params}`,
      {
        method: "POST",
        headers: embyHeaders(data.token, data.userId),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false as const,
        error: `Refresh failed (${res.status}). ${text.slice(0, 200)}`,
      };
    }
    return { ok: true as const, startedAt: new Date().toISOString() };
  });

