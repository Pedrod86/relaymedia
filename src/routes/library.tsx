import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { embyGetViews, embyGetItems, embyGetResume, embyRefreshLibrary } from "@/lib/emby.functions";
import { plexGetViews, plexGetItems, plexGetResume } from "@/lib/plex.functions";
import {
  listServers,
  loadActiveServer,
  setActiveServerId,
  loadHiddenViews,
  imageUrl,
  type MediaServer,
} from "@/lib/media-client";
import { Button } from "@/components/ui/button";
import { TraktRails } from "@/components/trakt-rails";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — Media" },
      { name: "description", content: "Browse your media library." },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const navigate = useNavigate();
  const [server, setServer] = useState<MediaServer | null>(null);
  const [servers, setServers] = useState<MediaServer[]>([]);

  useEffect(() => {
    const list = listServers();
    setServers(list);
    const active = loadActiveServer();
    if (!active) {
      navigate({ to: "/login" });
      return;
    }
    setServer(active);
  }, [navigate]);

  if (!server) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">Loading library…</p>
      </main>
    );
  }
  return (
    <LibraryContent
      server={server}
      servers={servers}
      onSwitch={(id) => {
        setActiveServerId(id);
        const next = listServers().find((s) => s.id === id);
        if (next) setServer(next);
      }}
    />
  );
}

function LibraryContent({
  server,
  servers,
  onSwitch,
}: {
  server: MediaServer;
  servers: MediaServer[];
  onSwitch: (id: string) => void;
}) {
  const isPlex = server.kind === "plex";
  const embyArg = { serverUrl: server.serverUrl, token: server.token, userId: server.userId };
  const plexArg = { serverUrl: server.serverUrl, token: server.token };

  const getViewsEmby = useServerFn(embyGetViews);
  const getResumeEmby = useServerFn(embyGetResume);
  const getViewsPlex = useServerFn(plexGetViews);
  const getResumePlex = useServerFn(plexGetResume);
  const refreshLibraryEmby = useServerFn(embyRefreshLibrary);
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  async function onSync() {
    if (isPlex) {
      toast.info("Library sync is Emby/Jellyfin only — Plex scans from its own server settings.");
      return;
    }
    setSyncing(true);
    try {
      const res = await refreshLibraryEmby({ data: embyArg });
      if (res.ok) {
        toast.success("Sync started on server. Refreshing in 10s…");
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["views", server.id] });
          queryClient.invalidateQueries({ queryKey: ["resume", server.id] });
          queryClient.invalidateQueries({ queryKey: ["items", server.id] });
        }, 10_000);
      } else {
        toast.error(res.error);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const hidden = useMemo(() => new Set(loadHiddenViews(server.id)), [server.id]);

  const views = useQuery({
    queryKey: ["views", server.id],
    queryFn: () =>
      isPlex ? getViewsPlex({ data: plexArg }) : getViewsEmby({ data: embyArg }),
  });
  const resume = useQuery({
    queryKey: ["resume", server.id],
    queryFn: () =>
      isPlex ? getResumePlex({ data: plexArg }) : getResumeEmby({ data: embyArg }),
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {server.kind} · {server.name}
            </p>
            <h1 className="text-lg font-semibold">Hi, {server.userName}</h1>
          </div>
          <div className="flex items-center gap-2">
            {servers.length > 1 && (
              <select
                value={server.id}
                onChange={(e) => onSwitch(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-sm"
                aria-label="Switch server"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.kind})
                  </option>
                ))}
              </select>
            )}
            <Button variant="ghost" asChild>
              <Link to="/settings">Settings</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-12 px-6 py-8">
        {resume.data && resume.data.items.length > 0 && (
          <Section title="Continue watching">
            <Row items={resume.data.items} server={server} kind="thumb" />
          </Section>
        )}

        {views.isLoading && <p className="text-muted-foreground">Loading library…</p>}
        {views.error && (
          <p className="text-destructive">Failed to load library. Check your server and try again.</p>
        )}

        {views.data?.views.filter((v) => !hidden.has(v.Id)).map((v) => (
          <LibrarySection key={v.Id} view={v} server={server} />
        ))}

        <TraktRails />
      </div>
    </main>
  );
}

function LibrarySection({
  view,
  server,
}: {
  view: { Id: string; Name: string; CollectionType?: string };
  server: MediaServer;
}) {
  const isPlex = server.kind === "plex";
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemsPlex = useServerFn(plexGetItems);
  const q = useQuery({
    queryKey: ["items", server.id, view.Id],
    queryFn: () =>
      isPlex
        ? getItemsPlex({
            data: { serverUrl: server.serverUrl, token: server.token, parentId: view.Id, limit: 30, sortBy: "addedAt:desc" },
          })
        : getItemsEmby({
            data: {
              serverUrl: server.serverUrl,
              token: server.token,
              userId: server.userId,
              parentId: view.Id,
              limit: 30,
              sortBy: "DateCreated,SortName",
            },
          }),
  });
  if (!q.data || q.data.items.length === 0) return null;
  return (
    <Section title={view.Name}>
      <Row items={q.data.items} server={server} kind="primary" />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  items,
  server,
  kind,
}: {
  items: any[];
  server: MediaServer;
  kind: "primary" | "thumb";
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
      {items.map((it) => {
        const portrait = kind === "primary";
        const imgType = kind === "thumb" ? "Thumb" : "Primary";
        const src = imageUrl(server, it, imgType, { maxWidth: 400 });
        return (
          <Link
            key={it.Id}
            to="/item/$id"
            params={{ id: it.Id }}
            className="group flex-shrink-0"
            style={{ width: portrait ? 160 : 280 }}
          >
            <div
              className="relative overflow-hidden rounded-lg bg-muted ring-1 ring-border transition group-hover:ring-primary"
              style={{ aspectRatio: portrait ? "2/3" : "16/9" }}
            >
              <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-muted-foreground">
                {it.Name}
              </div>
              {src && (
                <img
                  src={src}
                  alt={it.Name}
                  loading="lazy"
                  onError={(e) => {
                    // Hide the broken image so the name placeholder underneath shows.
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  className="relative h-full w-full object-cover transition group-hover:scale-105"
                />
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
  );
}

