// In-app update check for the Android APK.
//
// Flow: read the installed version from the native AppUpdater plugin, fetch the
// published manifest (/api/public/app-version), and if a newer versionCode is
// available download the APK through the plugin and hand it to the Android
// package installer. On the web every call no-ops.

import { isAndroidNative } from "./platform";
import type { AppRelease } from "./app-release";

type Listener = { remove: () => void } | undefined;

type AppUpdaterPlugin = {
  getInfo: () => Promise<{
    available: boolean;
    versionName?: string;
    versionCode?: number;
    canInstall?: boolean;
  }>;
  downloadAndInstall: (opts: { url: string }) => Promise<{ started: boolean }>;
  openInstallPermissionSettings: () => Promise<void>;
  addListener: (
    event: "downloadProgress",
    cb: (data: { percent: number; bytes: number; total: number }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
};

function plugin(): AppUpdaterPlugin | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } };
  return (w.Capacitor?.Plugins?.["AppUpdater"] as AppUpdaterPlugin | undefined) ?? null;
}

export type UpdateCheck = {
  updateAvailable: boolean;
  currentVersionName: string;
  currentVersionCode: number;
  release: AppRelease | null;
  canInstall: boolean;
};

const SKIP_KEY = "relay:update:skipped-code";

/** Version the user chose to skip (never nags again for that build). */
export function skipRelease(versionCode: number) {
  try {
    localStorage.setItem(SKIP_KEY, String(versionCode));
  } catch {
    /* storage unavailable */
  }
}

function isSkipped(versionCode: number) {
  try {
    return localStorage.getItem(SKIP_KEY) === String(versionCode);
  } catch {
    return false;
  }
}

/** Returns null when not applicable (web, plugin missing, or offline). */
export async function checkForUpdate(): Promise<UpdateCheck | null> {
  if (!isAndroidNative()) return null;
  const p = plugin();
  if (!p) return null;

  let info: Awaited<ReturnType<AppUpdaterPlugin["getInfo"]>>;
  try {
    info = await p.getInfo();
  } catch {
    return null;
  }
  if (!info?.available) return null;

  let release: AppRelease | null = null;
  try {
    const res = await fetch(`/api/public/app-version?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) release = ((await res.json()) as { android?: AppRelease }).android ?? null;
  } catch {
    return null;
  }

  const currentCode = Number(info.versionCode ?? 0);
  const updateAvailable =
    !!release && Number(release.versionCode) > currentCode && !isSkipped(release.versionCode);

  return {
    updateAvailable,
    currentVersionName: info.versionName ?? "—",
    currentVersionCode: currentCode,
    release,
    canInstall: info.canInstall !== false,
  };
}

/** Download + install, reporting 0-100 progress. Resolves once the installer opens. */
export async function downloadAndInstall(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  const p = plugin();
  if (!p) return { ok: false, error: "Updater unavailable on this device." };

  let sub: Listener;
  try {
    if (onProgress) {
      const maybe = p.addListener("downloadProgress", (d) => onProgress(d.percent));
      sub = maybe instanceof Promise ? await maybe : maybe;
    }
    await p.downloadAndInstall({ url });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    sub?.remove();
  }
}

/** Send the user to Android's "install unknown apps" toggle for Relay. */
export async function openInstallPermission(): Promise<void> {
  try {
    await plugin()?.openInstallPermissionSettings();
  } catch {
    /* ignore */
  }
}
