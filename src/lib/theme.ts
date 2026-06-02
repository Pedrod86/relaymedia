export type ThemeName = "default" | "neon" | "minimal";
const KEY = "ui_theme_v1";
const CLASSES: Record<ThemeName, string> = {
  default: "",
  neon: "theme-neon",
  minimal: "theme-minimal",
};

export function loadTheme(): ThemeName {
  if (typeof window === "undefined") return "default";
  const v = localStorage.getItem(KEY) as ThemeName | null;
  return v && v in CLASSES ? v : "default";
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const c of Object.values(CLASSES)) if (c) el.classList.remove(c);
  const cls = CLASSES[theme];
  if (cls) el.classList.add(cls);
}

export function saveTheme(theme: ThemeName) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
