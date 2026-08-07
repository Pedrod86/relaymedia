import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { traktScrobble } from "@/lib/trakt.functions";

type ScrobbleIds = { imdb?: string; tmdb?: number; tvdb?: number };

export type ScrobbleTarget = {
  type: "movie" | "episode";
  title?: string;
  year?: number;
  ids?: ScrobbleIds;
  season?: number;
  number?: number;
  showTitle?: string;
  showIds?: ScrobbleIds;
};

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function pickIds(providerIds: any): ScrobbleIds | undefined {
  if (!providerIds || typeof providerIds !== "object") return undefined;
  // Emby capitalises provider keys; be tolerant of either casing.
  const get = (k: string) =>
    providerIds[k] ?? providerIds[k.toLowerCase()] ?? providerIds[k.toUpperCase()];
  const out: ScrobbleIds = {};
  const imdb = get("Imdb");
  if (typeof imdb === "string" && imdb.startsWith("tt")) out.imdb = imdb;
  const tmdb = num(get("Tmdb"));
  if (tmdb) out.tmdb = tmdb;
  const tvdb = num(get("Tvdb"));
  if (tvdb) out.tvdb = tvdb;
  return Object.keys(out).length ? out : undefined;
}

/** Map an Emby/Jellyfin item onto a Trakt scrobble target. */
export function scrobbleTargetFromEmbyItem(item: any): ScrobbleTarget | null {
  if (!item) return null;
  const type = String(item.Type ?? "");
  if (type === "Movie") {
    return {
      type: "movie",
      title: item.Name ? String(item.Name) : undefined,
      year: num(item.ProductionYear),
      ids: pickIds(item.ProviderIds),
    };
  }
  if (type === "Episode") {
    return {
      type: "episode",
      ids: pickIds(item.ProviderIds),
      season: num(item.ParentIndexNumber),
      number: num(item.IndexNumber),
      showTitle: item.SeriesName ? String(item.SeriesName) : undefined,
      showIds: pickIds(item.SeriesProviderIds),
    };
  }
  return null;
}

/**
 * Scrobbles playback to Trakt: `start` on play, `pause` on pause/seek-away and
 * `stop` when playback ends or the player unmounts. Trakt marks the title
 * watched itself once a stop lands past ~80%.
 *
 * Enabled is left to the caller — a not-connected account just no-ops
 * server-side, so nothing needs to be gated in the UI.
 */
export function useTraktScrobble(
  video: React.RefObject<HTMLVideoElement | null>,
  target: ScrobbleTarget | null,
  enabled = true,
) {
  const scrobbleFn = useServerFn(traktScrobble);
  const lastAction = useRef<"start" | "pause" | "stop" | null>(null);
  const targetRef = useRef<ScrobbleTarget | null>(target);
  targetRef.current = target;

  useEffect(() => {
    const el = video.current;
    if (!el || !enabled || !target) return;

    let disabled = false;

    function progressOf(el: HTMLVideoElement) {
      if (!el.duration || !Number.isFinite(el.duration)) return 0;
      return Math.min(100, Math.max(0, (el.currentTime / el.duration) * 100));
    }

    async function send(action: "start" | "pause" | "stop", progress: number) {
      const t = targetRef.current;
      if (disabled || !t) return;
      if (lastAction.current === action && action !== "stop") return;
      lastAction.current = action;
      try {
        const res = await scrobbleFn({ data: { ...t, action, progress } });
        // A missing/expired Trakt link shouldn't spam the network for the rest
        // of the film — stop trying for this playback session.
        if (!res.ok && res.error === "not_connected") disabled = true;
      } catch {
        /* scrobbling is best-effort; never break playback */
      }
    }

    const onPlay = () => void send("start", progressOf(el));
    const onPause = () => {
      if (el.ended) return;
      void send("pause", progressOf(el));
    };
    const onEnded = () => void send("stop", 100);

    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      // Leaving the player is a stop; Trakt uses this to set watched state.
      if (lastAction.current && lastAction.current !== "stop") {
        void send("stop", progressOf(el));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, enabled, target?.type, target?.ids?.imdb, target?.ids?.tmdb, target?.season, target?.number, target?.title]);
}
