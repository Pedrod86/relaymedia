import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BrandLoader } from "@/components/BrandLoader";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { embyGetItems, embyGetViews } from "@/lib/emby.functions";
import { plexGetItems, plexGetViews } from "@/lib/plex.functions";
import { cleanName, itemTypesFor, type MediaServer } from "@/lib/media-client";
import { MediaImage } from "@/components/MediaImage";
import { useMediaServers } from "@/lib/use-servers";
import { isTvDevice } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Sort presets, mapped to each backend's own sort field names.
const SORTS = [
  { id: "name", label: "Name (A–Z)", emby: ["SortName", "Ascending"], plex: "titleSort:asc" },
  { id: "name-desc", label: "Name (Z–A)", emby: ["SortName", "Descending"], plex: "titleSort:desc" },
  { id: "added", label: "Recently added", emby: ["DateCreated", "Descending"], plex: "addedAt:desc" },
  { id: "released", label: "Release date", emby: ["PremiereDate,ProductionYear", "Descending"], plex: "originallyAvailableAt:desc" },
  { id: "rating", label: "Top rated", emby: ["CommunityRating", "Descending"], plex: "audienceRating:desc" },
  { id: "played", label: "Recently played", emby: ["DatePlayed", "Descending"], plex: "lastViewedAt:desc" },
  { id: "random", label: "Random", emby: ["Random", "Ascending"], plex: "random:asc" },
] as const;

export const Route = createFileRoute("/view/$id")({
  head: () => ({
    meta: [{ title: "Library — Media" }],
  }),
  component: ViewPage,
});

function ViewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { active, isLoading } = useMediaServers();
  const [tv, setTv] = useState(false);

  useEffect(() => {
    setTv(
      isTvDevice() ||
        (typeof localStorage === "undefined"
          ? false
          : localStorage.getItem("relay:tv-mode") === "1"),
    );
  }, []);

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <ViewContent key={active.id} server={active} viewId={id} tv={tv} />;
}

function ViewContent({
  server,
  viewId,
  tv,
}: {
  server: MediaServer;
  viewId: string;
  tv: boolean;
}) {
  const isPlex = server.kind === "plex";
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemsPlex = useServerFn(plexGetItems);
  const getViewsEmby = useServerFn(embyGetViews);
  const getViewsPlex = useServerFn(plexGetViews);
  const [sortId, setSortId] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "name";
    return localStorage.getItem("relay:view-sort") ?? "name";
  });
  const sort = SORTS.find((s) => s.id === sortId) ?? SORTS[0];

  const views = useQuery({
    queryKey: ["views", server.id],
    queryFn: () =>
      isPlex
        ? getViewsPlex({ data: { serverId: server.id } })
        : getViewsEmby({ data: { serverId: server.id } }),
  });

  const view = views.data?.views.find((v) => v.Id === viewId);

  const items = useQuery({
    queryKey: ["view-items", server.id, viewId, view?.CollectionType ?? "", sort.id],
    enabled: isPlex || views.isSuccess,
    queryFn: () =>
      isPlex
        ? getItemsPlex({
            data: {
              serverId: server.id,
              parentId: viewId,
              limit: 200,
              sortBy: sort.plex,
            },
          })
        : getItemsEmby({
            data: {
              serverId: server.id,
              parentId: viewId,
              limit: 200,
              sortBy: sort.emby[0],
              sortOrder: sort.emby[1],
              recursive: true,
              includeItemTypes: itemTypesFor(view?.CollectionType),
            },
          }),
  });

  // TV remote (D-pad) navigation. Browsers never move focus with arrow keys
  // and TV WebViews only scroll the page, so we drive focus ourselves: between
  // the header controls (sort menu, Back) and the poster grid below.
  useEffect(() => {
    if (!tv) return;
    const gridCards = () => {
      const grid = document.querySelector<HTMLElement>("[data-relay-grid]");
      if (!grid) return [] as HTMLElement[];
      return Array.from(grid.querySelectorAll<HTMLElement>("a[href]")).filter(
        (el) => el.offsetParent !== null,
      );
    };
    const headerItems = () => {
      const header = document.querySelector<HTMLElement>("header");
      if (!header) return [] as HTMLElement[];
      const sel = 'a[href], button:not([disabled]), [role="combobox"]';
      return Array.from(new Set(header.querySelectorAll<HTMLElement>(sel))).filter(
        (el) => el.offsetParent !== null,
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const ae = document.activeElement as HTMLElement | null;
      // The open sort menu handles its own keys.
      if (ae?.closest("[data-radix-popper-content-wrapper], [role='listbox']")) return;
      const isOnSortMenu =
        !!ae && ae.getAttribute("role") === "combobox" &&
        ["ArrowDown", "ArrowUp"].includes(e.key);
      if (isOnSortMenu) return; // Radix opens/operates the menu itself.

      if (ae?.closest("header")) {
        const list = headerItems();
        const i = list.indexOf(ae!);
        if (e.key === "ArrowRight" && i < list.length - 1) {
          e.preventDefault();
          e.stopPropagation();
          list[i + 1]!.focus({ preventScroll: true });
        } else if (e.key === "ArrowLeft" && i > 0) {
          e.preventDefault();
          e.stopPropagation();
          list[i - 1]!.focus({ preventScroll: true });
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          gridCards()[0]?.focus({ preventScroll: true });
        }
        return;
      }

      const cards = gridCards();
      if (!cards.length) return;
      const i = cards.indexOf(ae as HTMLElement);
      if (i < 0) return; // Focus is elsewhere on the page — leave it alone.

      // Group cards into visual rows by their vertical position.
      const rows: HTMLElement[][] = [];
      for (const c of cards) {
        const top = c.getBoundingClientRect().top;
        const row = rows.find(
          (r) => Math.abs(r[0]!.getBoundingClientRect().top - top) < 40,
        );
        if (row) row.push(c);
        else rows.push([c]);
      }
      const r = rows.findIndex((row) => row.includes(ae as HTMLElement));
      const col = rows[r]!.indexOf(ae as HTMLElement);
      const move = (target: HTMLElement | undefined) => {
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
      };
      if (e.key === "ArrowRight") move(rows[r]![Math.min(col + 1, rows[r]!.length - 1)]);
      else if (e.key === "ArrowLeft") move(rows[r]![Math.max(col - 1, 0)]);
      else if (e.key === "ArrowDown") move(rows[Math.min(r + 1, rows.length - 1)]?.[Math.min(col, (rows[Math.min(r + 1, rows.length - 1)] ?? []).length - 1)]);
      else if (e.key === "ArrowUp") {
        if (r <= 0) {
          // Top of the grid: hand focus to the header (sort menu first).
          e.preventDefault();
          e.stopPropagation();
          headerItems()[0]?.focus({ preventScroll: true });
        } else {
          move(rows[r - 1]?.[Math.min(col, rows[r - 1]!.length - 1)]);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tv, viewId]);

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {server.name}
            </p>
            <h1 className="text-lg font-semibold">{view?.Name ?? "Library"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={sortId}
              onValueChange={(v) => {
                setSortId(v);
                try {
                  localStorage.setItem("relay:view-sort", v);
                } catch {
                  /* storage unavailable */
                }
              }}
            >
              <SelectTrigger className="tv-card h-9 w-[9.5rem] text-xs" aria-label="Sort library">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" asChild>
              <Link to="/library">Back</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {items.isLoading && <BrandLoader label="Loading library…" />}
        {items.error && (
          <p className="text-destructive">Failed to load this library.</p>
        )}
        {items.data && items.data.items.length === 0 && (
          <p className="text-muted-foreground">No items in this library.</p>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.data?.items.map((it: any) => {
            return (
              <Link
                key={it.Id}
                to="/item/$id"
                params={{ id: it.Id }}
                className="group"
              >
                <div
                  className="overflow-hidden rounded-lg bg-muted ring-1 ring-border transition group-hover:ring-primary"
                  style={{ aspectRatio: "2/3" }}
                >
                  <MediaImage
                    server={server}
                    item={it}
                    type="Primary"
                    maxWidth={400}
                    alt={cleanName(it.Name)}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    fallback={
                      <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                        {cleanName(it.Name)}
                      </div>
                    }
                  />
                </div>

                <p className="mt-2 line-clamp-1 text-sm font-medium">{cleanName(it.Name)}</p>
                {it.ProductionYear && (
                  <p className="text-xs text-muted-foreground">{it.ProductionYear}</p>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
