// Server functions for pairing a Trakt account (OAuth device flow — works the
// same on phone and TV, no keyboard-hostile browser redirect) and for
// scrobbling playback. Tokens never leave the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type TraktStatus =
  | { connected: false; configured: boolean }
  | {
      connected: true;
      configured: true;
      username: string;
      connectedAt: string;
      expiresAt: number;
    };

export const traktStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<TraktStatus> => {
    const { readTrakt, toPublicTrakt, traktApp } = await import("./trakt.server");
    let configured = true;
    try {
      traktApp();
    } catch {
      configured = false;
    }
    if (!configured) return { connected: false, configured: false };
    const cred = await readTrakt();
    return cred
      ? { ...toPublicTrakt(cred), configured: true as const }
      : { connected: false, configured: true };
  },
);

/** Start the device pairing: returns the code the user types on trakt.tv. */
export const traktStartPairing = createServerFn({ method: "POST" }).handler(async () => {
  const { requestDeviceCode } = await import("./trakt.server");
  try {
    const d = await requestDeviceCode();
    return {
      ok: true as const,
      deviceCode: d.device_code,
      userCode: d.user_code,
      verificationUrl: d.verification_url,
      expiresIn: d.expires_in,
      interval: d.interval,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg === "TRAKT_NOT_CONFIGURED")
      return {
        ok: false as const,
        error: "Trakt isn't configured for this app yet.",
      };
    return { ok: false as const, error: msg };
  }
});

/** Poll until the user approves the code on trakt.tv. */
export const traktPollPairing = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceCode: z.string().min(10).max(200) }))
  .handler(async ({ data }) => {
    const { pollDeviceToken, writeTrakt, toPublicTrakt } = await import("./trakt.server");
    try {
      const out = await pollDeviceToken(data.deviceCode);
      if (out.state === "authorized") {
        await writeTrakt(out.cred);
        return { state: "authorized" as const, status: toPublicTrakt(out.cred) };
      }
      return { state: out.state, error: "error" in out ? out.error : undefined };
    } catch (e: any) {
      return { state: "error" as const, error: String(e?.message ?? e) };
    }
  });

export const traktDisconnect = createServerFn({ method: "POST" }).handler(async () => {
  const { writeTrakt } = await import("./trakt.server");
  await writeTrakt(null);
  return { ok: true as const };
});

const ids = z
  .object({
    imdb: z.string().max(30).optional(),
    tmdb: z.number().int().optional(),
    tvdb: z.number().int().optional(),
  })
  .partial();

const scrobbleInput = z.object({
  action: z.enum(["start", "pause", "stop"]),
  progress: z.number().min(0).max(100),
  type: z.enum(["movie", "episode"]),
  title: z.string().max(300).optional(),
  year: z.number().int().optional(),
  ids: ids.optional(),
  season: z.number().int().optional(),
  number: z.number().int().optional(),
  showTitle: z.string().max(300).optional(),
  showIds: ids.optional(),
});

function hasAnyId(v?: Record<string, unknown>) {
  return Boolean(v && Object.values(v).some((x) => x !== undefined && x !== null));
}

/**
 * Send one scrobble event. Trakt marks a title watched when a `stop` arrives
 * past ~80% progress, so the player just forwards start/pause/stop.
 */
export const traktScrobble = createServerFn({ method: "POST" })
  .inputValidator(scrobbleInput)
  .handler(async ({ data }) => {
    const { traktRequest } = await import("./trakt.server");
    const body: Record<string, unknown> = { progress: data.progress };

    if (data.type === "movie") {
      if (!hasAnyId(data.ids) && !data.title)
        return { ok: false as const, error: "Nothing to identify this movie with." };
      body["movie"] = {
        ...(data.title ? { title: data.title } : {}),
        ...(data.year ? { year: data.year } : {}),
        ids: data.ids ?? {},
      };
    } else {
      const episodeIdentified = hasAnyId(data.ids);
      const showIdentified = hasAnyId(data.showIds) || Boolean(data.showTitle);
      if (!episodeIdentified && !(showIdentified && data.season && data.number))
        return { ok: false as const, error: "Nothing to identify this episode with." };
      body["episode"] = {
        ...(data.season ? { season: data.season } : {}),
        ...(data.number ? { number: data.number } : {}),
        ids: data.ids ?? {},
      };
      if (showIdentified) {
        body["show"] = {
          ...(data.showTitle ? { title: data.showTitle } : {}),
          ids: data.showIds ?? {},
        };
      }
    }

    try {
      await traktRequest(`/scrobble/${data.action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { ok: true as const };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "TRAKT_NOT_CONNECTED") return { ok: false as const, error: "not_connected" };
      if (msg === "TRAKT_REAUTH_REQUIRED")
        return { ok: false as const, error: "Trakt needs to be reconnected." };
      return { ok: false as const, error: msg };
    }
  });

export type TraktHistoryEntry = {
  id: number;
  watchedAt: string;
  title: string;
  subtitle: string | null;
};

/** Recent Trakt history, used to show the pairing actually works. */
export const traktRecentHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ items: TraktHistoryEntry[] } | { error: string }> => {
    const { traktRequest } = await import("./trakt.server");
    try {
      const rows = await traktRequest<any[]>("/sync/history?limit=10");
      const items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: Number(r.id),
        watchedAt: String(r.watched_at ?? ""),
        title: String(r.movie?.title ?? r.show?.title ?? "Unknown"),
        subtitle: r.episode
          ? `S${r.episode.season}E${r.episode.number} · ${r.episode.title ?? ""}`.trim()
          : r.movie?.year
            ? String(r.movie.year)
            : null,
      }));
      return { items };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "TRAKT_NOT_CONNECTED") return { error: "Trakt is not connected." };
      return { error: msg };
    }
  },
);
