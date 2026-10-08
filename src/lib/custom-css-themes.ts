type ThemePalette = {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  primary: string;
  onPrimary: string;
  border: string;
};

function stylesheet(p: ThemePalette) {
  return `/* Relay Media appearance preset */
:root:root {
  --background: ${p.background};
  --foreground: ${p.foreground};
  --card: ${p.card};
  --card-foreground: ${p.foreground};
  --popover: ${p.card};
  --popover-foreground: ${p.foreground};
  --primary: ${p.primary};
  --primary-foreground: ${p.onPrimary};
  --secondary: ${p.card};
  --secondary-foreground: ${p.foreground};
  --muted: ${p.card};
  --muted-foreground: ${p.muted};
  --accent: ${p.card};
  --accent-foreground: ${p.foreground};
  --border: ${p.border};
  --input: ${p.border};
  --ring: ${p.primary};
  --sidebar: ${p.background};
  --sidebar-foreground: ${p.foreground};
  --sidebar-primary: ${p.primary};
  --sidebar-primary-foreground: ${p.onPrimary};
  --sidebar-accent: ${p.card};
  --sidebar-accent-foreground: ${p.foreground};
  --sidebar-border: ${p.border};
  --sidebar-ring: ${p.primary};
}
html body {
  background: var(--background);
  color: var(--foreground);
}
`;
}

export const CUSTOM_CSS_THEMES = [
  { id: "cinema", name: "Cinema", description: "Charcoal · red accents", css: stylesheet({ background: "oklch(0.14 0 0)", card: "oklch(0.22 0 0)", foreground: "oklch(0.97 0 0)", muted: "oklch(0.73 0 0)", primary: "oklch(0.65 0.23 25)", onPrimary: "oklch(0.99 0 0)", border: "oklch(1 0 0 / 16%)" }) },
  { id: "ocean", name: "Ocean", description: "Graphite · turquoise accents", css: stylesheet({ background: "oklch(0.17 0.012 200)", card: "oklch(0.25 0.018 200)", foreground: "oklch(0.97 0.008 200)", muted: "oklch(0.74 0.025 200)", primary: "oklch(0.8 0.14 185)", onPrimary: "oklch(0.16 0.025 185)", border: "oklch(0.8 0.07 185 / 22%)" }) },
  { id: "daylight", name: "Daylight", description: "Bright white · green accents", css: stylesheet({ background: "oklch(0.98 0 0)", card: "oklch(0.94 0.008 145)", foreground: "oklch(0.22 0.01 145)", muted: "oklch(0.45 0.015 145)", primary: "oklch(0.48 0.13 150)", onPrimary: "oklch(0.99 0 0)", border: "oklch(0.22 0.01 145 / 20%)" }) },
  { id: "contrast", name: "High Contrast", description: "Deep black · yellow accents", css: stylesheet({ background: "oklch(0.05 0 0)", card: "oklch(0.16 0 0)", foreground: "oklch(1 0 0)", muted: "oklch(0.86 0 0)", primary: "oklch(0.91 0.18 100)", onPrimary: "oklch(0.1 0 0)", border: "oklch(1 0 0 / 55%)" }) },
];