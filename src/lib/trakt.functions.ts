// Trakt OAuth (device-code flow) + thin API wrapper. Server-only — keeps
// TRAKT_CLIENT_SECRET out of the browser. Tokens are returned to the client,
// which persists them in localStorage and sends them back on subsequent calls.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const API = "https://api.trakt.tv";
const CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;

function requireKeys() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Trakt credentials are not configured on the server.");
  }
  return { id: CLIENT_ID, secret: CLIENT_SECRET };
}

function headers(token?: string) {
  const { id } = requireKeys();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": id,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// ── Device code flow ──────────────────────────────────────────────────────

export const traktDeviceCode = createServerFn({ method: "POST" }).handler(async () => {
  const { id } = requireKeys();
  const res = await fetch(`${API}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id }),
  });
  if (!res.ok) {
    return { ok: false as const, error: `Trakt device code failed (${res.status})` };
  }
  const json = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };
  return { ok: true as const, ...json };
});

export const traktDevicePoll = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceCode: z.string().min(10).max(200) }))
  .handler(async ({ data }) => {
    const { id, secret } = requireKeys();
    const res = await fetch(`${API}/oauth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: data.deviceCode,
        client_id: id,
        client_secret: secret,
      }),
    });
    // 200 = authorized, 400 = pending, 404 = not found, 409 = already used,
    // 410 = expired, 418 = denied, 429 = slow down.
    if (res.status === 400) return { ok: false as const, status: "pending" as const };
    if (res.status === 429) return { ok: false as const, status: "slow_down" as const };
    if (res.status === 410) return { ok: false as const, status: "expired" as const };
    if (res.status === 418) return { ok: false as const, status: "denied" as const };
    if (!res.ok) return { ok: false as const, status: "error" as const, error: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      created_at: number;
      token_type: string;
      scope: string;
    };
    return { ok: true as const, ...json };
  });

export const traktRefresh = createServerFn({ method: "POST" })
  .inputValidator(z.object({ refreshToken: z.string().min(10).max(500) }))
  .handler(async ({ data }) => {
    const { id, secret } = requireKeys();
    const res = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: data.refreshToken,
        client_id: id,
        client_secret: secret,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return { ok: false as const, error: `Trakt refresh failed (${res.status})` };
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      created_at: number;
    };
    return { ok: true as const, ...json };
  });

export const traktRevoke = createServerFn({ method: "POST" })
  .inputValidator(z.object({ accessToken: z.string().min(10).max(500) }))
  .handler(async ({ data }) => {
    const { id, secret } = requireKeys();
    await fetch(`${API}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: data.accessToken,
        client_id: id,
        client_secret: secret,
      }),
    });
    return { ok: true as const };
  });

// ── API wrappers ──────────────────────────────────────────────────────────

const authSchema = z.object({ accessToken: z.string().min(10).max(500) });

async function traktGet(path: string, token?: string) {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Trakt ${path} failed: ${res.status}`);
  return res.json();
}

export const traktGetUser = createServerFn({ method: "POST" })
  .inputValidator(authSchema)
  .handler(async ({ data }) => {
    const me = (await traktGet("/users/me?extended=full", data.accessToken)) as {
      username: string;
      name: string;
      ids: { slug: string };
      images?: { avatar?: { full?: string } };
    };
    return { user: me };
  });

export const traktTrending = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["movies", "shows"]),
      limit: z.number().int().min(1).max(40).default(20),
    })
  )
  .handler(async ({ data }) => {
    const items = (await traktGet(
      `/${data.kind}/trending?limit=${data.limit}&extended=full`
    )) as unknown[];
    return { items };
  });

export const traktRecommended = createServerFn({ method: "POST" })
  .inputValidator(
    authSchema.extend({
      kind: z.enum(["movies", "shows"]),
      limit: z.number().int().min(1).max(40).default(20),
    })
  )
  .handler(async ({ data }) => {
    const items = (await traktGet(
      `/recommendations/${data.kind}?limit=${data.limit}&extended=full`,
      data.accessToken
    )) as unknown[];
    return { items };
  });

export const traktWatchlist = createServerFn({ method: "POST" })
  .inputValidator(authSchema)
  .handler(async ({ data }) => {
    const items = (await traktGet(
      "/sync/watchlist?extended=full",
      data.accessToken
    )) as unknown[];
    return { items };
  });

export const traktHistory = createServerFn({ method: "POST" })
  .inputValidator(authSchema.extend({ limit: z.number().int().min(1).max(100).default(40) }))
  .handler(async ({ data }) => {
    const items = (await traktGet(
      `/sync/history?limit=${data.limit}&extended=full`,
      data.accessToken
    )) as unknown[];
    return { items };
  });

export const traktCollection = createServerFn({ method: "POST" })
  .inputValidator(authSchema.extend({ kind: z.enum(["movies", "shows"]) }))
  .handler(async ({ data }) => {
    const items = (await traktGet(
      `/sync/collection/${data.kind}?extended=full`,
      data.accessToken
    )) as unknown[];
    return { items };
  });

// ── Scrobble (play / pause / stop) ────────────────────────────────────────

const scrobbleSchema = authSchema.extend({
  action: z.enum(["start", "pause", "stop"]),
  progress: z.number().min(0).max(100),
  // Either movie OR episode lookup — pass the IMDb id we get from Emby/Plex.
  imdbId: z.string().min(2).max(20).optional(),
  tmdbId: z.number().int().optional(),
  type: z.enum(["movie", "episode"]),
  season: z.number().int().optional(),
  number: z.number().int().optional(),
});

export const traktScrobble = createServerFn({ method: "POST" })
  .inputValidator(scrobbleSchema)
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = { progress: data.progress };
    const ids: Record<string, unknown> = {};
    if (data.imdbId) ids.imdb = data.imdbId;
    if (data.tmdbId) ids.tmdb = data.tmdbId;
    if (data.type === "movie") {
      body.movie = { ids };
    } else {
      body.episode = { ids, season: data.season, number: data.number };
    }
    const res = await fetch(`${API}/scrobble/${data.action}`, {
      method: "POST",
      headers: headers(data.accessToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false as const, error: `Scrobble failed (${res.status})` };
    return { ok: true as const };
  });
