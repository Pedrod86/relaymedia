// Personalization hub: a card list that opens focused sub-pages
// (Navigation, Home Screen, Libraries, Media Bar, Local Previews,
// Seasonal Effects, Theme Music), matching the settings hub pattern.
import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Home,
  Image as ImageIcon,
  Library,
  Music,
  PanelsTopLeft,
  Sparkles,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { usePersonalization, type ImageType, type SeasonalEffect } from "@/lib/personalization";

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Panel({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-3 divide-y">{children}</div>
    </section>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="sm"
          variant={o.id === value ? "default" : "outline"}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export function PersonalizationHub({
  themePanel,
  librariesPanel,
}: {
  themePanel: ReactNode;
  librariesPanel: ReactNode;
}) {
  const { prefs, update, reset } = usePersonalization();
  const [openId, setOpenId] = useState<string | null>(null);

  const pages: {
    id: string;
    group: "Layout" | "Extras" | "General";
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    render: () => ReactNode;
  }[] = [
    {
      id: "navigation",
      group: "General",
      title: "Navigation",
      desc: "Toolbar buttons, greeting, appearance",
      icon: PanelsTopLeft,
      render: () => (
        <>
          <Panel title="Navigation" desc="How the top bar and menu behave on this device.">
            <Row
              label="Quick action buttons"
              desc="Show Search, Refresh and TV mode icons in the top bar as well as the menu."
            >
              <Switch
                checked={prefs.quickActions}
                onCheckedChange={(v) => update("quickActions", v)}
              />
            </Row>
            <Row label="Server greeting" desc="Show “Hi, <user>” and the server name in the top bar.">
              <Switch
                checked={prefs.showServerGreeting}
                onCheckedChange={(v) => update("showServerGreeting", v)}
              />
            </Row>
          </Panel>
          {themePanel}
        </>
      ),
    },
    {
      id: "home",
      group: "Layout",
      title: "Home Screen",
      desc: "Sections, image types, overlays",
      icon: Home,
      render: () => (
        <Panel title="Home Screen" desc="Card artwork and overlays on the home rows.">
          <Row label="Card artwork" desc="Portrait posters or landscape thumbnails.">
            <Choice<ImageType>
              value={prefs.imageType}
              options={[
                { id: "poster", label: "Poster" },
                { id: "thumb", label: "Thumbnail" },
              ]}
              onChange={(v) => update("imageType", v)}
            />
          </Row>
          <Row label="Show titles">
            <Switch checked={prefs.showTitles} onCheckedChange={(v) => update("showTitles", v)} />
          </Row>
          <Row label="Show years">
            <Switch checked={prefs.showYears} onCheckedChange={(v) => update("showYears", v)} />
          </Row>
          <Row label="Progress overlays" desc="Resume bar across partly-watched artwork.">
            <Switch
              checked={prefs.showProgress}
              onCheckedChange={(v) => update("showProgress", v)}
            />
          </Row>
        </Panel>
      ),
    },
    {
      id: "libraries",
      group: "Layout",
      title: "Libraries",
      desc: "Library visibility and home rows",
      icon: Library,
      render: () => (
        <>
          <Panel title="Library rows" desc="Full library rows below the curated rows on home.">
            <Row label="Show library rows on home">
              <Switch
                checked={prefs.showLibraryRows}
                onCheckedChange={(v) => update("showLibraryRows", v)}
              />
            </Row>
          </Panel>
          {librariesPanel}
        </>
      ),
    },
    {
      id: "mediabar",
      group: "Extras",
      title: "Media Bar",
      desc: "Featured content, appearance",
      icon: ImageIcon,
      render: () => (
        <Panel title="Media Bar" desc="The floating featured poster reel at the top of home.">
          <Row label="Show media bar">
            <Switch checked={prefs.mediaBar} onCheckedChange={(v) => update("mediaBar", v)} />
          </Row>
          <Row label={`Featured items — ${prefs.mediaBarCount}`}>
            <div className="w-40">
              <Slider
                value={[prefs.mediaBarCount]}
                min={3}
                max={20}
                step={1}
                onValueChange={([v]) => update("mediaBarCount", v ?? 8)}
              />
            </div>
          </Row>
          <Row label={`Rotate every ${prefs.mediaBarRotateSeconds}s`}>
            <div className="w-40">
              <Slider
                value={[prefs.mediaBarRotateSeconds]}
                min={3}
                max={20}
                step={1}
                onValueChange={([v]) => update("mediaBarRotateSeconds", v ?? 6)}
              />
            </div>
          </Row>
        </Panel>
      ),
    },
    {
      id: "previews",
      group: "Extras",
      title: "Local Previews",
      desc: "Configure trailer and audio previews",
      icon: Eye,
      render: () => (
        <Panel title="Local Previews" desc="Trailer previews on movie and show detail pages.">
          <Row label="Autoplay trailers" desc="Start the trailer as soon as the preview opens.">
            <Switch
              checked={prefs.trailerAutoplay}
              onCheckedChange={(v) => update("trailerAutoplay", v)}
            />
          </Row>
          <Row label="Start muted">
            <Switch
              checked={prefs.previewMuted}
              onCheckedChange={(v) => update("previewMuted", v)}
            />
          </Row>
        </Panel>
      ),
    },
    {
      id: "seasonal",
      group: "Extras",
      title: "Seasonal Effects",
      desc: "Visual effects and decorations",
      icon: Sparkles,
      render: () => (
        <Panel title="Seasonal Effects" desc="Decorative particles over the app.">
          <Row label="Effect">
            <Choice<SeasonalEffect>
              value={prefs.seasonal}
              options={[
                { id: "off", label: "Off" },
                { id: "auto", label: "Auto" },
                { id: "snow", label: "Snow" },
                { id: "sparkle", label: "Sparkle" },
              ]}
              onChange={(v) => update("seasonal", v)}
            />
          </Row>
        </Panel>
      ),
    },
    {
      id: "music",
      group: "Extras",
      title: "Theme Music",
      desc: "Detail pages, home rows, and volume",
      icon: Music,
      render: () => (
        <Panel title="Theme Music" desc="Background audio from preview and theme tracks.">
          <Row label="Play theme music" desc="Uses the trailer/theme audio on detail pages.">
            <Switch checked={prefs.themeMusic} onCheckedChange={(v) => update("themeMusic", v)} />
          </Row>
          <Row label={`Volume — ${prefs.themeMusicVolume}%`}>
            <div className="w-40">
              <Slider
                value={[prefs.themeMusicVolume]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => update("themeMusicVolume", v ?? 40)}
              />
            </div>
          </Row>
        </Panel>
      ),
    },
  ];

  const open = pages.find((p) => p.id === openId);
  if (open) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setOpenId(null)} aria-label="Back">
            <ChevronLeft className="size-5" />
          </Button>
          <h2 className="text-xl font-semibold">{open.title}</h2>
        </div>
        {open.render()}
      </div>
    );
  }

  const groups: ("General" | "Layout" | "Extras")[] = ["General", "Layout", "Extras"];

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <div key={g} className="space-y-4">
          {g !== "General" && (
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{g}</p>
          )}
          {pages
            .filter((p) => p.group === g)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenId(p.id)}
                className="tv-card flex w-full items-center gap-4 rounded-2xl border bg-card/60 p-5 text-left transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-14 shrink-0 place-items-center rounded-xl border bg-accent/40">
                  <p.icon className="size-7 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{p.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{p.desc}</span>
                </span>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
              </button>
            ))}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={reset}>
        Reset personalization
      </Button>
    </div>
  );
}
