// Emby / Jellyfin share the same HTTP API (Jellyfin is a fork). These server
// functions work for both — the `kind` field is informational only.
//
// Access tokens are never accepted from, or returned to, the browser: they are
// stored in the encrypted httpOnly cookie vault and resolved server-side from
// an opaque serverId.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { embyAuthHeader, embyFetch, normalizeUrl } from "./media.server";

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
      const text = await res.text().catch(() => "");
      return { ok: false as const, error: `Login failed (${res.status}). ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      AccessToken: string;
      User: { Id: string; Name: string };
    };
    const { addCredential } = await import("./vault.server");
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
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear",
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

export const embyGetItem = createServerFn({ method: "POST" })
  .inputValidator(serverRef.extend({ itemId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const item = (await embyFetch(c, `/Users/${c.userId}/Items/${data.itemId}`)) as any;
    return { item };
  });

export const embyGetResume = createServerFn({ method: "POST" })
  .inputValidator(serverRef)
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const c = await requireCredential(data.serverId);
    const params = new URLSearchParams({
      Limit: "20",
      Fields: "PrimaryImageAspectRatio,Overview",
      MediaTypes: "Video",
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
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear,BackdropImageTags",
      IncludeItemTypes: "Movie,Series",
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
      return {
        ok: false as const,
        error: `Refresh failed (${res.status}). ${text.slice(0, 200)}`,
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
      Fields: "PrimaryImageAspectRatio,Overview,ProductionYear,SeriesName,ParentIndexNumber,IndexNumber",
      ImageTypeLimit: "1",
      EnableImageTypes: "Primary,Backdrop,Thumb",
    });
    const json = (await embyFetch(c, `/Users/${c.userId}/Items?${params}`)) as { Items: any[] };
    return { items: json.Items ?? [] };
  });
