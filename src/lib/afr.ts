// Automatic Frame Rate (AFR) matching.
//
// A browser cannot switch the physical display refresh rate (no web API exists
// for it), so "working AFR" here means everything a web client *can* do:
//
//  1. Detect the source frame rate from the media server's stream metadata.
//  2. Measure the actual refresh rate of the display the video is on.
//  3. Ask the server to preserve the source cadence (never fps-convert) so the
//     original 23.976 / 24 / 25 / 50 / 60 fps timing reaches the decoder.
//  4. When the display cadence is not an exact multiple of the source cadence,
//     apply the smallest possible speed correction (classic PAL-style pull-up,
//     e.g. 23.976 -> 25 on a 50 Hz panel) so frames land on refresh boundaries
//     instead of juddering with a 3:2 pattern.
//  5. Report the resulting cadence and dropped-frame count to the UI.

export type AfrMode = "off" | "auto" | "strict";

export type AfrPlan = {
  /** Source frame rate in fps, when the server reported one. */
  sourceFps?: number;
  /** Measured display refresh rate in Hz. */
  displayHz?: number;
  /** Frames shown per source frame (2 = 48 Hz for 24 fps). */
  cadence?: number;
  /** Effective playback rate applied to the video element. */
  playbackRate: number;
  /** True when the display cadence is an exact multiple of the source. */
  exact: boolean;
  /** Human-readable explanation for the player UI. */
  note: string;
};

export const AFR_OFF: AfrPlan = { playbackRate: 1, exact: false, note: "AFR off" };

/** Largest speed correction we will ever apply (~4.3% = 23.976 -> 25). */
const MAX_CORRECTION = 0.045;

/** Read the source frame rate out of an Emby/Jellyfin item. */
export function sourceFrameRate(item: any): number | undefined {
  const source = item?.MediaSources?.[0];
  const streams: any[] = source?.MediaStreams ?? item?.MediaStreams ?? [];
  const v = streams.find((s) => s.Type === "Video");
  const fps = Number(v?.AverageFrameRate ?? v?.RealFrameRate ?? 0);
  return Number.isFinite(fps) && fps > 1 ? fps : undefined;
}

/**
 * Measure the display refresh rate by timing animation frames.
 * Resolves to the rounded Hz (60, 50, 120, 144…) or undefined if unavailable.
 */
export function measureRefreshRate(samples = 90): Promise<number | undefined> {
  if (typeof window === "undefined" || !window.requestAnimationFrame) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = 0;
    let count = 0;
    const tick = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (++count < samples) {
        requestAnimationFrame(tick);
        return;
      }
      const usable = deltas.filter((d) => d > 1 && d < 100).sort((a, b) => a - b);
      if (usable.length < 10) return resolve(undefined);
      // Median delta ignores GC / compositor hiccups.
      const median = usable[Math.floor(usable.length / 2)]!;
      const hz = 1000 / median;
      resolve(snapHz(hz));
    };
    requestAnimationFrame(tick);
  });
}

const COMMON_HZ = [24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

function snapHz(hz: number): number {
  let best = COMMON_HZ[0]!;
  for (const c of COMMON_HZ) if (Math.abs(c - hz) < Math.abs(best - hz)) best = c;
  // Only snap when we're within 3 Hz; otherwise trust the measurement.
  return Math.abs(best - hz) <= 3 ? best : Math.round(hz);
}

/**
 * Work out the best cadence for a source frame rate on a given display.
 * `strict` allows the speed correction; `auto` only applies it when the
 * uncorrected cadence would judder noticeably (>0.5% off an exact multiple).
 */
export function planFrameRate(
  mode: AfrMode,
  sourceFps?: number,
  displayHz?: number,
): AfrPlan {
  if (mode === "off") return AFR_OFF;
  if (!sourceFps) {
    return { displayHz, playbackRate: 1, exact: false, note: "AFR: source frame rate unknown" };
  }
  if (!displayHz) {
    return { sourceFps, playbackRate: 1, exact: false, note: "AFR: display refresh rate unknown" };
  }

  const ratio = displayHz / sourceFps;
  const cadence = Math.max(1, Math.round(ratio));
  const drift = Math.abs(ratio / cadence - 1); // relative distance from an exact multiple

  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

  if (drift < 0.001) {
    return {
      sourceFps,
      displayHz,
      cadence,
      playbackRate: 1,
      exact: true,
      note: `AFR: ${fmt(sourceFps)} fps on ${displayHz} Hz — exact ${cadence}:1 cadence, no correction needed`,
    };
  }

  // Speed needed so each source frame occupies a whole number of refreshes.
  const targetFps = displayHz / cadence;
  const rate = targetFps / sourceFps;
  const correction = Math.abs(rate - 1);

  const shouldCorrect =
    correction <= MAX_CORRECTION && (mode === "strict" || drift > 0.005);

  if (!shouldCorrect) {
    return {
      sourceFps,
      displayHz,
      cadence,
      playbackRate: 1,
      exact: false,
      note:
        correction > MAX_CORRECTION
          ? `AFR: ${fmt(sourceFps)} fps on ${displayHz} Hz — cadence mismatch too large to correct, expect judder`
          : `AFR: ${fmt(sourceFps)} fps on ${displayHz} Hz — near-exact ${cadence}:1 cadence`,
    };
  }

  return {
    sourceFps,
    displayHz,
    cadence,
    playbackRate: rate,
    exact: true,
    note: `AFR: ${fmt(sourceFps)} fps pulled to ${fmt(targetFps)} fps for a clean ${cadence}:1 cadence on ${displayHz} Hz (${(
      (rate - 1) *
      100
    ).toFixed(2)}% speed)`,
  };
}

export type FrameStats = { dropped: number; decoded: number };

/** Read dropped/decoded frame counters from a video element, when exposed. */
export function readFrameStats(video: HTMLVideoElement): FrameStats | undefined {
  const q = (video as any).getVideoPlaybackQuality?.();
  if (q) return { dropped: q.droppedVideoFrames ?? 0, decoded: q.totalVideoFrames ?? 0 };
  const dropped = (video as any).webkitDroppedFrameCount;
  const decoded = (video as any).webkitDecodedFrameCount;
  if (typeof dropped === "number") return { dropped, decoded: decoded ?? 0 };
  return undefined;
}
