// Snapshot / restore the device's non-sensitive UI preferences so a phone can
// hand its whole look and layout (theme, personalization, row order, hidden
// libraries, favourites, watch later, watch history, player prefs) to the TV.
//
// Access tokens are NEVER in localStorage — they live in encrypted httpOnly
// cookies — so nothing here is a credential.

const PREFIXES = ["relay:", "media:", "media_", "ui_theme"];
const SKIP = ["media_servers_v1", "emby_session_v1"];

function synced(key: string) {
  if (SKIP.includes(key)) return false;
  return PREFIXES.some((p) => key.startsWith(p));
}

export function snapshotDevicePrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof window === "undefined") return out;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !synced(key)) continue;
    const value = localStorage.getItem(key);
    if (value != null && value.length < 200_000) out[key] = value;
  }
  return out;
}

/** Apply a snapshot from another device. Returns how many keys were written. */
export function applyDevicePrefs(prefs: Record<string, string>): number {
  if (typeof window === "undefined") return 0;
  let n = 0;
  for (const [key, value] of Object.entries(prefs)) {
    if (!synced(key)) continue;
    localStorage.setItem(key, value);
    n++;
  }
  return n;
}
