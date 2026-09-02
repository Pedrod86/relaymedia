// Bridge to the Android AndroidX Media3 / ExoPlayer plugin.
//
// Inside the APK, playback is handed to ExoPlayer so the device's own decoders
// handle MKV, Dolby Digital / Digital Plus (AC3 / E-AC3), HEVC 10-bit HDR10 and
// Dolby Vision without the server transcoding. On the web these calls no-op.

import { isAndroidNative } from "./platform";

type Media3Plugin = {
  isAvailable: () => Promise<{ available: boolean }>;
  play: (opts: {
    url: string;
    title?: string;
    subtitleUrl?: string;
    subtitleLang?: string;
    startPositionMs?: number;
    tunneling?: boolean;
  }) => Promise<void>;
};

function plugin(): Media3Plugin | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } };
  const p = w.Capacitor?.Plugins?.["Media3Player"] as Media3Plugin | undefined;
  return p ?? null;
}

/** True when the native Media3 player can take over playback on this device. */
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

/** Hand a stream to the native Media3 / ExoPlayer surface. */
export async function media3Play(opts: {
  url: string;
  title?: string;
  subtitleUrl?: string;
  subtitleLang?: string;
  startPositionMs?: number;
  tunneling?: boolean;
}): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    await p.play({ tunneling: true, ...opts });
    return true;
  } catch {
    return false;
  }
}
