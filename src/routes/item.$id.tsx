import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { embyGetItem, embyGetItems, embyRefreshItem } from "@/lib/emby.functions";
import { plexGetItem, plexRefreshItem } from "@/lib/plex.functions";
import { loadActiveServer, imageUrl, ticksToTime, type MediaServer } from "@/lib/media-client";
import { Button } from "@/components/ui/button";


export const Route = createFileRoute("/item/$id")({
  head: () => ({ meta: [{ title: "Details — Media" }] }),
  component: ItemPage,
});

function ItemPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [server, setServer] = useState<MediaServer | null>(null);
  useEffect(() => {
    const s = loadActiveServer();
    if (!s) navigate({ to: "/login" });
    else setServer(s);
  }, [navigate]);

  if (!server) {
    return (
      <main className="min-h-screen bg-background p-8 text-muted-foreground">
        Loading…
      </main>
    );
  }
  return <Detail server={server} id={id} />;
}

function Detail({ server, id }: { server: MediaServer; id: string }) {
  const isPlex = server.kind === "plex";
  const getItemEmby = useServerFn(embyGetItem);
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemPlex = useServerFn(plexGetItem);
  const refreshEmby = useServerFn(embyRefreshItem);
  const refreshPlex = useServerFn(plexRefreshItem);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const itemQ = useQuery({
    queryKey: ["item", server.id, id],
    queryFn: () =>
      isPlex
        ? getItemPlex({ data: { serverUrl: server.serverUrl, token: server.token, itemId: id } })
        : getItemEmby({ data: { serverUrl: server.serverUrl, token: server.token, userId: server.userId, itemId: id } }),
  });

  async function onRefreshMetadata(replace: boolean) {
    setRefreshing(true);
    try {
      const res = isPlex
        ? await refreshPlex({
            data: { serverUrl: server.serverUrl, token: server.token, itemId: id, replace },
          })
        : await refreshEmby({
            data: {
              serverUrl: server.serverUrl,
              token: server.token,
              userId: server.userId,
              itemId: id,
              replace,
              recursive: true,
            },
          });
      if (res.ok) {
        toast.success(
          replace
            ? "Replacing metadata. New data shows up shortly."
            : "Refreshing metadata. New data shows up shortly."
        );
        // Re-fetch this item and its children after a short delay so the
        // server has time to pull new data.
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["item", server.id, id] });
          queryClient.invalidateQueries({ queryKey: ["children", server.id, id] });
        }, 3000);
      } else {
        toast.error(res.error);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }


  const item = itemQ.data?.item;
  const isFolder = item?.IsFolder || item?.Type === "Series" || item?.Type === "Season";

  // For Plex the detail call already returns _children. For Emby we fetch.
  const childrenQ = useQuery({
    enabled: !!item && isFolder && !isPlex,
    queryKey: ["children", server.id, id],
    queryFn: () =>
      getItemsEmby({
        data: {
          serverUrl: server.serverUrl,
          token: server.token,
          userId: server.userId,
          parentId: id,
          limit: 100,
          sortBy: "SortName",
        },
      }),
  });

  if (!item) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const backdrop = imageUrl(server, item, "Backdrop", { maxWidth: 1920 });
  const poster = imageUrl(server, item, "Primary", { maxWidth: 400 });

  const children: any[] = isPlex ? item._children ?? [] : childrenQ.data?.items ?? [];

  return (
    <main className="min-h-screen bg-background">
      <div className="relative">
        {backdrop && (
          <div
            className="absolute inset-0 h-[60vh]"
            style={{
              backgroundImage: `linear-gradient(to bottom, transparent 0%, oklch(0.16 0.02 270 / 0.6) 50%, var(--background) 100%), url("${backdrop}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}
        <div className="relative mx-auto max-w-6xl px-6 pt-8">
          <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to library
          </Link>
          <div className="mt-32 flex flex-col gap-8 md:flex-row md:items-end">
            {poster && (
              <img
                src={poster}
                alt={item.Name}
                className="w-48 rounded-xl shadow-2xl ring-1 ring-border"
              />
            )}
            <div className="flex-1">
              <h1 className="text-4xl font-bold tracking-tight">{item.Name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {[item.ProductionYear, item.OfficialRating, ticksToTime(item.RunTimeTicks)]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
              {item.Overview && (
                <p className="mt-4 max-w-2xl text-muted-foreground">{item.Overview}</p>
              )}
              {!isFolder && (
                <Button size="lg" asChild className="mt-6">
                  <Link to="/watch/$id" params={{ id: item.Id }}>
                    ▶ Play
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isFolder && children.length > 0 && (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="mb-4 text-xl font-semibold">Episodes</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((ep: any) => {
              const epImg = imageUrl(server, ep, "Primary", { maxWidth: 600 });
              return (
                <Link
                  key={ep.Id}
                  to={ep.IsFolder ? "/item/$id" : "/watch/$id"}
                  params={{ id: ep.Id }}
                  className="group overflow-hidden rounded-lg border bg-card transition hover:border-primary"
                >
                  {epImg && (
                    <img
                      src={epImg}
                      alt={ep.Name}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="p-3">
                    <p className="font-medium">
                      {ep.IndexNumber ? `${ep.IndexNumber}. ` : ""}
                      {ep.Name}
                    </p>
                    {ep.Overview && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ep.Overview}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
