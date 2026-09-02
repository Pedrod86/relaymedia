// Per-device personalization preferences (navigation, home screen, media bar,
// previews, seasonal effects, theme music). Stored in localStorage and broadcast
// so open screens react immediately.
import { useEffect, useState } from "react";

const KEY = "relay:personalization:v1";
const EVENT = "relay:personalization-change";

export type ImageType = "poster" | "thumb";
export type SeasonalEffect = "off" | "auto" | "snow" | "sparkle";

export type Personalization = {
  // Navigation
  quickActions: boolean;
  showServerGreeting: boolean;
  // Home screen
  imageType: ImageType;
  showTitles: boolean;
  showYears: boolean;
  showProgress: boolean;
  // Libraries
  showLibraryRows: boolean;
  // Media bar (floating hero)
  mediaBar: boolean;
  mediaBarCount: number;
  mediaBarRotateSeconds: number;
  // Local previews
  trailerAutoplay: boolean;
  previewMuted: boolean;
  // Extras
  seasonal: SeasonalEffect;
  themeMusic: boolean;
  themeMusicVolume: number; // 0–100
};

export const DEFAULT_PERSONALIZATION: Personalization = {
  quickActions: false,
  showServerGreeting: true,
  imageType: "poster",
  showTitles: true,
  showYears: true,
  showProgress: true,
  showLibraryRows: true,
  mediaBar: true,
  mediaBarCount: 8,
  mediaBarRotateSeconds: 6,
  trailerAutoplay: true,
  previewMuted: false,
  seasonal: "off",
  themeMusic: false,
  themeMusicVolume: 40,
};

export function loadPersonalization(): Personalization {
  if (typeof window === "undefined") return DEFAULT_PERSONALIZATION;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PERSONALIZATION;
    return { ...DEFAULT_PERSONALIZATION, ...(JSON.parse(raw) as Partial<Personalization>) };
  } catch {
    return DEFAULT_PERSONALIZATION;
  }
}

export function savePersonalization(next: Personalization) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Reactive access to the preferences; updates across screens on change. */
export function usePersonalization() {
  const [prefs, setPrefs] = useState<Personalization>(DEFAULT_PERSONALIZATION);

  useEffect(() => {
    setPrefs(loadPersonalization());
    const sync = () => setPrefs(loadPersonalization());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function update<K extends keyof Personalization>(key: K, value: Personalization[K]) {
    const next = { ...loadPersonalization(), [key]: value };
    setPrefs(next);
    savePersonalization(next);
  }

  function reset() {
    setPrefs(DEFAULT_PERSONALIZATION);
    savePersonalization(DEFAULT_PERSONALIZATION);
  }

  return { prefs, update, reset };
}

/** Whether a seasonal overlay should render right now. */
export function activeSeasonalEffect(effect: SeasonalEffect, date = new Date()): "snow" | "sparkle" | null {
  if (effect === "off") return null;
  if (effect === "snow") return "snow";
  if (effect === "sparkle") return "sparkle";
  const m = date.getMonth();
  if (m === 11 || m === 0) return "snow"; // Dec–Jan
  if (m === 9) return "sparkle"; // October
  return null;
}
