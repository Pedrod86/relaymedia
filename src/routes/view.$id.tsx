import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { embyGetItems, embyGetViews } from "@/lib/emby.functions";
import { plexGetItems, plexGetViews } from "@/lib/plex.functions";
import { cleanName, itemTypesFor, type MediaServer } from "@/lib/media-client";
import { MediaImage } from "@/components/MediaImage";
import { useMediaServers } from "@/lib/use-servers";
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

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <ViewContent key={active.id} server={active} viewId={id} />;
}

function ViewContent({ server, viewId }: { server: MediaServer; viewId: string }) {
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
        {items.isLoading && <p className="text-muted-foreground">Loading…</p>}
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
