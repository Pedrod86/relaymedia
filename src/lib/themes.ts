// Theme presets. Each theme overrides CSS variables defined in src/styles.css.
// Applied at runtime by toggling data-theme on <html> and injecting vars.

export type ThemeId =
  | "cinematic"
  | "midnight"
  | "neon-pulse"
  | "cyber-magenta"
  | "matrix"
  | "obsidian"
  | "ice-blue"
  | "arctic"
  | "daylight"
  | "sunset"
  | "ember"
  | "forest";

export interface ThemePreset {
  id: ThemeId;
  name: string;
  description: string;
  swatch: string[]; // 3-4 hex for preview swatch
  vars: Record<string, string>;
}

export const THEMES: ThemePreset[] = [
  {
    id: "cinematic",
    name: "Cinematic (default)",
    description: "Dark neutral with emerald accent — built for video.",
    swatch: ["#1a1a26", "#2a2a38", "#22c896", "#f5f5f7"],
    vars: {
      "--background": "oklch(0.16 0.02 270)",
      "--foreground": "oklch(0.97 0.01 270)",
      "--card": "oklch(0.21 0.025 270)",
      "--card-foreground": "oklch(0.97 0.01 270)",
      "--popover": "oklch(0.21 0.025 270)",
      "--popover-foreground": "oklch(0.97 0.01 270)",
      "--primary": "oklch(0.72 0.18 150)",
      "--primary-foreground": "oklch(0.15 0.02 270)",
      "--secondary": "oklch(0.27 0.03 270)",
      "--secondary-foreground": "oklch(0.97 0.01 270)",
      "--muted": "oklch(0.25 0.025 270)",
      "--muted-foreground": "oklch(0.7 0.03 270)",
      "--accent": "oklch(0.3 0.04 270)",
      "--accent-foreground": "oklch(0.97 0.01 270)",
      "--border": "oklch(1 0 0 / 10%)",
      "--input": "oklch(1 0 0 / 12%)",
      "--ring": "oklch(0.72 0.18 150)",
      "--sidebar": "oklch(0.18 0.02 270)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Pure black with indigo accent. Pitch-dark rooms.",
    swatch: ["#000000", "#0a0a14", "#6366f1", "#e0e7ff"],
    vars: {
      "--background": "oklch(0.06 0.005 270)",
      "--foreground": "oklch(0.95 0.01 270)",
      "--card": "oklch(0.11 0.01 270)",
      "--card-foreground": "oklch(0.95 0.01 270)",
      "--popover": "oklch(0.11 0.01 270)",
      "--popover-foreground": "oklch(0.95 0.01 270)",
      "--primary": "oklch(0.65 0.2 280)",
      "--primary-foreground": "oklch(0.98 0.01 270)",
      "--secondary": "oklch(0.17 0.015 270)",
      "--secondary-foreground": "oklch(0.95 0.01 270)",
      "--muted": "oklch(0.15 0.01 270)",
      "--muted-foreground": "oklch(0.65 0.02 270)",
      "--accent": "oklch(0.22 0.04 280)",
      "--accent-foreground": "oklch(0.95 0.01 270)",
      "--border": "oklch(1 0 0 / 8%)",
      "--input": "oklch(1 0 0 / 10%)",
      "--ring": "oklch(0.65 0.2 280)",
      "--sidebar": "oklch(0.08 0.008 270)",
    },
  },
  {
    id: "neon-pulse",
    name: "Neon Pulse",
    description: "Deep black with electric cyan glow.",
    swatch: ["#020617", "#0f172a", "#00f5d4", "#00b4d8"],
    vars: {
      "--background": "oklch(0.1 0.02 240)",
      "--foreground": "oklch(0.97 0.02 200)",
      "--card": "oklch(0.15 0.03 240)",
      "--card-foreground": "oklch(0.97 0.02 200)",
      "--popover": "oklch(0.15 0.03 240)",
      "--popover-foreground": "oklch(0.97 0.02 200)",
      "--primary": "oklch(0.85 0.18 190)",
      "--primary-foreground": "oklch(0.1 0.02 240)",
      "--secondary": "oklch(0.22 0.05 240)",
      "--secondary-foreground": "oklch(0.97 0.02 200)",
      "--muted": "oklch(0.2 0.04 240)",
      "--muted-foreground": "oklch(0.7 0.05 200)",
      "--accent": "oklch(0.55 0.2 200)",
      "--accent-foreground": "oklch(0.97 0.02 200)",
      "--border": "oklch(0.85 0.18 190 / 20%)",
      "--input": "oklch(0.85 0.18 190 / 15%)",
      "--ring": "oklch(0.85 0.18 190)",
      "--sidebar": "oklch(0.12 0.025 240)",
    },
  },
  {
    id: "cyber-magenta",
    name: "Cyber Magenta",
    description: "Neon pink/purple on near-black. Synthwave vibes.",
    swatch: ["#0d0014", "#1f0033", "#ff2d92", "#a855f7"],
    vars: {
      "--background": "oklch(0.1 0.04 320)",
      "--foreground": "oklch(0.97 0.02 320)",
      "--card": "oklch(0.16 0.05 320)",
      "--card-foreground": "oklch(0.97 0.02 320)",
      "--popover": "oklch(0.16 0.05 320)",
      "--popover-foreground": "oklch(0.97 0.02 320)",
      "--primary": "oklch(0.72 0.28 0)",
      "--primary-foreground": "oklch(0.98 0.01 320)",
      "--secondary": "oklch(0.24 0.08 320)",
      "--secondary-foreground": "oklch(0.97 0.02 320)",
      "--muted": "oklch(0.2 0.06 320)",
      "--muted-foreground": "oklch(0.72 0.06 320)",
      "--accent": "oklch(0.55 0.25 310)",
      "--accent-foreground": "oklch(0.98 0.01 320)",
      "--border": "oklch(0.72 0.28 0 / 22%)",
      "--input": "oklch(0.72 0.28 0 / 16%)",
      "--ring": "oklch(0.72 0.28 0)",
      "--sidebar": "oklch(0.12 0.05 320)",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Black terminal with phosphor green.",
    swatch: ["#000000", "#0a1a0a", "#39ff14", "#00ff88"],
    vars: {
      "--background": "oklch(0.08 0.02 145)",
      "--foreground": "oklch(0.95 0.18 145)",
      "--card": "oklch(0.13 0.03 145)",
      "--card-foreground": "oklch(0.95 0.18 145)",
      "--popover": "oklch(0.13 0.03 145)",
      "--popover-foreground": "oklch(0.95 0.18 145)",
      "--primary": "oklch(0.85 0.25 145)",
      "--primary-foreground": "oklch(0.08 0.02 145)",
      "--secondary": "oklch(0.2 0.05 145)",
      "--secondary-foreground": "oklch(0.95 0.18 145)",
      "--muted": "oklch(0.17 0.04 145)",
      "--muted-foreground": "oklch(0.7 0.1 145)",
      "--accent": "oklch(0.4 0.15 145)",
      "--accent-foreground": "oklch(0.95 0.18 145)",
      "--border": "oklch(0.85 0.25 145 / 20%)",
      "--input": "oklch(0.85 0.25 145 / 14%)",
      "--ring": "oklch(0.85 0.25 145)",
      "--sidebar": "oklch(0.1 0.025 145)",
    },
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Monochrome charcoal. Zero color noise.",
    swatch: ["#0a0a0a", "#1a1a1a", "#3a3a3a", "#e5e5e5"],
    vars: {
      "--background": "oklch(0.12 0 0)",
      "--foreground": "oklch(0.96 0 0)",
      "--card": "oklch(0.18 0 0)",
      "--card-foreground": "oklch(0.96 0 0)",
      "--popover": "oklch(0.18 0 0)",
      "--popover-foreground": "oklch(0.96 0 0)",
      "--primary": "oklch(0.96 0 0)",
      "--primary-foreground": "oklch(0.12 0 0)",
      "--secondary": "oklch(0.24 0 0)",
      "--secondary-foreground": "oklch(0.96 0 0)",
      "--muted": "oklch(0.22 0 0)",
      "--muted-foreground": "oklch(0.68 0 0)",
      "--accent": "oklch(0.3 0 0)",
      "--accent-foreground": "oklch(0.96 0 0)",
      "--border": "oklch(1 0 0 / 12%)",
      "--input": "oklch(1 0 0 / 14%)",
      "--ring": "oklch(0.7 0 0)",
      "--sidebar": "oklch(0.14 0 0)",
    },
  },
  {
    id: "ice-blue",
    name: "Ice Blue",
    description: "Dark navy with crisp ice-blue highlights.",
    swatch: ["#0c1929", "#15324d", "#7dd3fc", "#bae6fd"],
    vars: {
      "--background": "oklch(0.17 0.04 240)",
      "--foreground": "oklch(0.97 0.01 230)",
      "--card": "oklch(0.22 0.05 240)",
      "--card-foreground": "oklch(0.97 0.01 230)",
      "--popover": "oklch(0.22 0.05 240)",
      "--popover-foreground": "oklch(0.97 0.01 230)",
      "--primary": "oklch(0.82 0.12 230)",
      "--primary-foreground": "oklch(0.15 0.04 240)",
      "--secondary": "oklch(0.3 0.06 240)",
      "--secondary-foreground": "oklch(0.97 0.01 230)",
      "--muted": "oklch(0.26 0.05 240)",
      "--muted-foreground": "oklch(0.74 0.05 230)",
      "--accent": "oklch(0.4 0.1 230)",
      "--accent-foreground": "oklch(0.97 0.01 230)",
      "--border": "oklch(0.82 0.12 230 / 18%)",
      "--input": "oklch(0.82 0.12 230 / 14%)",
      "--ring": "oklch(0.82 0.12 230)",
      "--sidebar": "oklch(0.19 0.045 240)",
    },
  },
  {
    id: "arctic",
    name: "Arctic Light",
    description: "Light, airy whites with cool blue accents.",
    swatch: ["#f8fafc", "#e2e8f0", "#0284c7", "#0c4a6e"],
    vars: {
      "--background": "oklch(0.98 0.005 230)",
      "--foreground": "oklch(0.2 0.03 240)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.2 0.03 240)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.2 0.03 240)",
      "--primary": "oklch(0.55 0.18 240)",
      "--primary-foreground": "oklch(0.98 0.005 230)",
      "--secondary": "oklch(0.94 0.015 230)",
      "--secondary-foreground": "oklch(0.2 0.03 240)",
      "--muted": "oklch(0.95 0.012 230)",
      "--muted-foreground": "oklch(0.45 0.04 240)",
      "--accent": "oklch(0.9 0.04 230)",
      "--accent-foreground": "oklch(0.2 0.03 240)",
      "--border": "oklch(0.2 0.03 240 / 10%)",
      "--input": "oklch(0.2 0.03 240 / 12%)",
      "--ring": "oklch(0.55 0.18 240)",
      "--sidebar": "oklch(0.96 0.01 230)",
    },
  },
  {
    id: "daylight",
    name: "Daylight",
    description: "Clean light theme with neutral grays.",
    swatch: ["#ffffff", "#f1f5f9", "#0f172a", "#3b82f6"],
    vars: {
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.15 0.01 270)",
      "--card": "oklch(0.99 0 0)",
      "--card-foreground": "oklch(0.15 0.01 270)",
      "--popover": "oklch(0.99 0 0)",
      "--popover-foreground": "oklch(0.15 0.01 270)",
      "--primary": "oklch(0.55 0.2 260)",
      "--primary-foreground": "oklch(0.99 0 0)",
      "--secondary": "oklch(0.96 0.005 270)",
      "--secondary-foreground": "oklch(0.15 0.01 270)",
      "--muted": "oklch(0.96 0.005 270)",
      "--muted-foreground": "oklch(0.5 0.02 270)",
      "--accent": "oklch(0.94 0.01 270)",
      "--accent-foreground": "oklch(0.15 0.01 270)",
      "--border": "oklch(0.15 0.01 270 / 10%)",
      "--input": "oklch(0.15 0.01 270 / 12%)",
      "--ring": "oklch(0.55 0.2 260)",
      "--sidebar": "oklch(0.98 0.003 270)",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm dark with orange-magenta neon gradient.",
    swatch: ["#1a0a14", "#2d0f1f", "#ff6b35", "#e84393"],
    vars: {
      "--background": "oklch(0.14 0.03 20)",
      "--foreground": "oklch(0.97 0.02 40)",
      "--card": "oklch(0.19 0.04 20)",
      "--card-foreground": "oklch(0.97 0.02 40)",
      "--popover": "oklch(0.19 0.04 20)",
      "--popover-foreground": "oklch(0.97 0.02 40)",
      "--primary": "oklch(0.72 0.22 35)",
      "--primary-foreground": "oklch(0.14 0.03 20)",
      "--secondary": "oklch(0.26 0.06 20)",
      "--secondary-foreground": "oklch(0.97 0.02 40)",
      "--muted": "oklch(0.22 0.05 20)",
      "--muted-foreground": "oklch(0.72 0.05 40)",
      "--accent": "oklch(0.5 0.2 0)",
      "--accent-foreground": "oklch(0.97 0.02 40)",
      "--border": "oklch(0.72 0.22 35 / 20%)",
      "--input": "oklch(0.72 0.22 35 / 14%)",
      "--ring": "oklch(0.72 0.22 35)",
      "--sidebar": "oklch(0.16 0.035 20)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Charcoal with warm amber highlights.",
    swatch: ["#1a1a1a", "#2d2d2d", "#f59e0b", "#fbbf24"],
    vars: {
      "--background": "oklch(0.14 0.005 60)",
      "--foreground": "oklch(0.96 0.02 80)",
      "--card": "oklch(0.2 0.01 60)",
      "--card-foreground": "oklch(0.96 0.02 80)",
      "--popover": "oklch(0.2 0.01 60)",
      "--popover-foreground": "oklch(0.96 0.02 80)",
      "--primary": "oklch(0.78 0.16 70)",
      "--primary-foreground": "oklch(0.14 0.005 60)",
      "--secondary": "oklch(0.26 0.015 60)",
      "--secondary-foreground": "oklch(0.96 0.02 80)",
      "--muted": "oklch(0.23 0.012 60)",
      "--muted-foreground": "oklch(0.7 0.04 70)",
      "--accent": "oklch(0.36 0.06 60)",
      "--accent-foreground": "oklch(0.96 0.02 80)",
      "--border": "oklch(0.78 0.16 70 / 18%)",
      "--input": "oklch(0.78 0.16 70 / 12%)",
      "--ring": "oklch(0.78 0.16 70)",
      "--sidebar": "oklch(0.16 0.008 60)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green with mossy and gold accents.",
    swatch: ["#0a1f14", "#143324", "#10b981", "#fbbf24"],
    vars: {
      "--background": "oklch(0.15 0.03 155)",
      "--foreground": "oklch(0.96 0.02 145)",
      "--card": "oklch(0.2 0.04 155)",
      "--card-foreground": "oklch(0.96 0.02 145)",
      "--popover": "oklch(0.2 0.04 155)",
      "--popover-foreground": "oklch(0.96 0.02 145)",
      "--primary": "oklch(0.72 0.17 160)",
      "--primary-foreground": "oklch(0.15 0.03 155)",
      "--secondary": "oklch(0.27 0.05 155)",
      "--secondary-foreground": "oklch(0.96 0.02 145)",
      "--muted": "oklch(0.23 0.04 155)",
      "--muted-foreground": "oklch(0.72 0.05 145)",
      "--accent": "oklch(0.36 0.08 155)",
      "--accent-foreground": "oklch(0.96 0.02 145)",
      "--border": "oklch(0.72 0.17 160 / 18%)",
      "--input": "oklch(0.72 0.17 160 / 12%)",
      "--ring": "oklch(0.72 0.17 160)",
      "--sidebar": "oklch(0.17 0.035 155)",
    },
  },
];

const STORAGE_KEY = "relaymedia.theme";
const STYLE_ID = "relaymedia-theme-vars";

export function getThemeById(id: string | null | undefined): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function loadThemeId(): ThemeId {
  if (typeof window === "undefined") return "cinematic";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {}
  return "cinematic";
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  const theme = getThemeById(id);
  const css = `:root {\n${Object.entries(theme.vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}
