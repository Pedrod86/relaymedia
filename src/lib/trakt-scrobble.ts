// Helper that wires a <video> element to Trakt scrobble (start/pause/stop).
// Only fires when the user has a Trakt session AND we have an external id
// (IMDb or TMDb) for the item we're playing.
import { traktScrobble } from "./trakt.functions";
import { getValidTraktToken } from "./trakt-client";

export type ScrobbleTarget =
  | { type: "movie"; imdbId?: string; tmdbId?: number }
  | {
      type: "episode";
      imdbId?: string;
      tmdbId?: number;
      season?: number;
      number?: number;
    };

export function targetHasIds(t: ScrobbleTarget | null): boolean {
  return !!t && (!!t.imdbId || typeof t.tmdbId === "number");
}

async function send(action: "start" | "pause" | "stop", target: ScrobbleTarget, progress: number) {
  const token = await getValidTraktToken();
  if (!token) return;
  try {
    await traktScrobble({
      data: {
        accessToken: token,
        action,
        progress: Math.max(0, Math.min(100, progress)),
        type: target.type,
        imdbId: target.imdbId,
        tmdbId: target.tmdbId,
        season: target.type === "episode" ? target.season : undefined,
        number: target.type === "episode" ? target.number : undefined,
      },
    });
  } catch {
    /* network errors are non-fatal */
  }
}

/** Attach scrobble listeners. Returns a cleanup function. */
export function attachScrobble(video: HTMLVideoElement, target: ScrobbleTarget) {
  if (!targetHasIds(target)) return () => {};

  const pct = () =>
    video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;

  let started = false;
  const onPlay = () => {
    started = true;
    void send("start", target, pct());
  };
  const onPause = () => {
    if (started && !video.ended) void send("pause", target, pct());
  };
  const onEnded = () => {
    void send("stop", target, 100);
    started = false;
  };
  const onUnload = () => {
    if (started) void send("stop", target, pct());
  };

  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("ended", onEnded);
  window.addEventListener("pagehide", onUnload);

  return () => {
    video.removeEventListener("play", onPlay);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("ended", onEnded);
    window.removeEventListener("pagehide", onUnload);
    if (started) void send("stop", target, pct());
  };
}
