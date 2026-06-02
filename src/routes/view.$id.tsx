import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { embyGetItems, embyGetViews } from "@/lib/emby.functions";
import { plexGetItems, plexGetViews } from "@/lib/plex.functions";
import { loadActiveServer, imageUrl, type MediaServer } from "@/lib/media-client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/view/$id")({
  head: () => ({
    meta: [{ title: "Library — Media" }],
  }),
  component: ViewPage,
});

function ViewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [server, setServer] = useState<MediaServer | null>(null);

  useEffect(() => {
    const s = loadActiveServer();
    if (!s) navigate({ to: "/login" });
    else setServer(s);
  }, [navigate]);

  if (!server) return null;
  return <ViewContent server={server} viewId={id} />;
}

function ViewContent({ server, viewId }: { server: MediaServer; viewId: string }) {
  const isPlex = server.kind === "plex";
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemsPlex = useServerFn(plexGetItems);
  const getViewsEmby = useServerFn(embyGetViews);
  const getViewsPlex = useServerFn(plexGetViews);

  const views = useQuery({
    queryKey: ["views", server.id],
    queryFn: () =>
      isPlex
        ? getViewsPlex({ data: { serverUrl: server.serverUrl, token: server.token } })
        : getViewsEmby({
            data: { serverUrl: server.serverUrl, token: server.token, userId: server.userId },
          }),
  });

  const view = views.data?.views.find((v) => v.Id === viewId);

  const items = useQuery({
    queryKey: ["view-items", server.id, viewId],
    queryFn: () =>
      isPlex
        ? getItemsPlex({
            data: {
              serverUrl: server.serverUrl,
              token: server.token,
              parentId: viewId,
              limit: 200,
              sortBy: "titleSort",
            },
          })
        : getItemsEmby({
            data: {
              serverUrl: server.serverUrl,
              token: server.token,
              userId: server.userId,
              parentId: viewId,
              limit: 200,
              sortBy: "SortName",
              recursive: true,
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
          <Button variant="ghost" asChild>
            <Link to="/library">Back</Link>
          </Button>
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
            const src = imageUrl(server, it, "Primary", { maxWidth: 400 });
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
                  {src ? (
                    <img
                      src={src}
                      alt={it.Name}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                      {it.Name}
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-1 text-sm font-medium">{it.Name}</p>
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
