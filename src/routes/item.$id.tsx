import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { embyGetItem, embyGetItems } from "@/lib/emby.functions";
import { loadSession, imageUrl, ticksToTime, type EmbySession } from "@/lib/emby-client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/item/$id")({
  head: () => ({ meta: [{ title: "Details — Emby" }] }),
  component: ItemPage,
});

function ItemPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [session, setSession] = useState<EmbySession | null>(null);
  useEffect(() => {
    const s = loadSession();
    if (!s) navigate({ to: "/login" });
    else setSession(s);
  }, [navigate]);

  if (!session) return null;
  return <Detail session={session} id={id} />;
}

function Detail({ session, id }: { session: EmbySession; id: string }) {
  const getItem = useServerFn(embyGetItem);
  const getItems = useServerFn(embyGetItems);
  const sessionArg = { serverUrl: session.serverUrl, token: session.token, userId: session.userId };

  const itemQ = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem({ data: { ...sessionArg, itemId: id } }),
  });

  const item = itemQ.data?.item;
  const isFolder = item?.IsFolder || item?.Type === "Series" || item?.Type === "Season";

  const childrenQ = useQuery({
    enabled: !!item && isFolder,
    queryKey: ["children", id],
    queryFn: () =>
      getItems({
        data: { ...sessionArg, parentId: id, limit: 100, sortBy: "SortName" },
      }),
  });

  if (!item) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const backdropTag = item.BackdropImageTags?.[0];
  const backdrop = backdropTag
    ? imageUrl(session, item.Id, "Backdrop", { maxWidth: 1920, tag: backdropTag })
    : null;

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
            {item.ImageTags?.Primary && (
              <img
                src={imageUrl(session, item.Id, "Primary", {
                  maxWidth: 400,
                  tag: item.ImageTags.Primary,
                })}
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
                <Link to="/watch/$id" params={{ id: item.Id }} className="mt-6 inline-block">
                  <Button size="lg">▶ Play</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {isFolder && childrenQ.data && (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="mb-4 text-xl font-semibold">Episodes</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {childrenQ.data.items.map((ep: any) => (
              <Link
                key={ep.Id}
                to={ep.IsFolder ? "/item/$id" : "/watch/$id"}
                params={{ id: ep.Id }}
                className="group overflow-hidden rounded-lg border bg-card transition hover:border-primary"
              >
                {ep.ImageTags?.Primary && (
                  <img
                    src={imageUrl(session, ep.Id, "Primary", {
                      maxWidth: 600,
                      tag: ep.ImageTags.Primary,
                    })}
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
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
