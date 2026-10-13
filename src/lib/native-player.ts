// Bridge to the Android native players: AndroidX Media3 / ExoPlayer, or MPV.
//
// Inside the APK, playback is handed to a native player so the device's own
// decoders handle MKV, Dolby Digital / Digital Plus, HEVC 10-bit HDR10 and
// Dolby Vision without the server transcoding. On the web these calls no-op.
// Which engine is used comes from Settings → Player → Device player engine.

import { isAndroidNative } from "./platform";
import { loadPlayerPrefs } from "./player-prefs";

type PlayOpts = {
  url: string;
  title?: string;
  subtitleUrl?: string;
  subtitleLang?: string;
  startPositionMs?: number;
  tunneling?: boolean;
};

type Media3Plugin = {
  isAvailable: () => Promise<{ available: boolean; mpv?: boolean }>;
  play: (opts: PlayOpts) => Promise<void>;
  playMpv?: (opts: PlayOpts & { hwdec?: string; passthrough?: boolean }) => Promise<void>;
};

function plugin(): Media3Plugin | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } };
  const p = w.Capacitor?.Plugins?.["Media3Player"] as Media3Plugin | undefined;
  return p ?? null;
}

/** True when a native player can take over playback on this device. */
export async function media3Available(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const p = plugin();
  if (!p) return false;
  try {
    return (await p.isAvailable()).available === true;
  } catch {
    return false;
  }
}

/** True when this APK includes the built-in MPV engine (1.8+). */
export async function mpvAvailable(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const p = plugin();
  if (!p?.playMpv) return false;
  try {
    return (await p.isAvailable()).mpv === true;
  } catch {
    return false;
  }
}

/** Hand a stream to the selected native player (Media3 or MPV). */
export async function media3Play(opts: PlayOpts): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  const prefs = loadPlayerPrefs();
  if (prefs.nativeEngine === "mpv" && p.playMpv) {
    const hwdec =
      prefs.decode === "software" ? "no" : prefs.decode === "hardware" ? "mediacodec" : "mediacodec-copy";
    try {
      await p.playMpv({ ...opts, hwdec, passthrough: prefs.audioPassthrough });
      return true;
    } catch {
      // Older APK or MPV failed to start — fall through to Media3.
    }
  }
  try {
    await p.play({ ...opts, tunneling: false });
    return true;
  } catch {
    return false;
  }
}
