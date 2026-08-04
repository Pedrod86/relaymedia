import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { embyGetViews, embyGetItems, embyGetResume, embyGetLatest } from "@/lib/emby.functions";
import { plexGetViews, plexGetItems, plexGetResume, plexGetLatest } from "@/lib/plex.functions";
import { loadHiddenViews, imageUrl, cleanName, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { Button } from "@/components/ui/button";

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
  const { servers, active, isLoading, switchTo } = useMediaServers();

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return (
    <LibraryContent
      key={active.id}
      server={active}
      servers={servers}
      onSwitch={switchTo}
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
  // Only the opaque server id crosses the wire — the token is resolved
  // server-side from the encrypted cookie vault.
  const arg = { serverId: server.id };

  const getViewsEmby = useServerFn(embyGetViews);
  const getResumeEmby = useServerFn(embyGetResume);
  const getLatestEmby = useServerFn(embyGetLatest);
  const getViewsPlex = useServerFn(plexGetViews);
  const getResumePlex = useServerFn(plexGetResume);
  const getLatestPlex = useServerFn(plexGetLatest);

  const hidden = useMemo(() => new Set(loadHiddenViews(server.id)), [server.id]);

  const views = useQuery({
    queryKey: ["views", server.id],
    queryFn: () => (isPlex ? getViewsPlex({ data: arg }) : getViewsEmby({ data: arg })),
  });
  const resume = useQuery({
    queryKey: ["resume", server.id],
    queryFn: () => (isPlex ? getResumePlex({ data: arg }) : getResumeEmby({ data: arg })),
  });
  const latest = useQuery({
    queryKey: ["latest", server.id],
    queryFn: () => (isPlex ? getLatestPlex({ data: arg }) : getLatestEmby({ data: arg })),
  });


  const backdropItems = useMemo(() => {
    const pool = latest.data?.items ?? [];
    return pool
      .filter((it: any) => imageUrl(server, it, "Backdrop", { maxWidth: 1600 }))
      .slice(0, 5);
  }, [latest.data, server]);

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

      {backdropItems.length > 0 && (
        <BackdropHero items={backdropItems} server={server} />
      )}

      <div className="mx-auto max-w-7xl space-y-12 px-6 py-8">
        {resume.data && resume.data.items.length > 0 && (
          <Section title="Continue watching">
            <Row items={resume.data.items} server={server} kind="thumb" />
          </Section>
        )}

        {latest.data && latest.data.items.length > 0 && (
          <Section title="Recently added">
            <Row items={latest.data.items} server={server} kind="primary" />
          </Section>
        )}

        {views.isLoading && <p className="text-muted-foreground">Loading library…</p>}
        {views.error && (
          <p className="text-destructive">Failed to load library. Check your server and try again.</p>
        )}

        {views.data?.views.filter((v) => !hidden.has(v.Id)).map((v) => (
          <LibrarySection key={v.Id} view={v} server={server} />
        ))}
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
            data: { serverId: server.id, parentId: view.Id, limit: 30, sortBy: "addedAt:desc" },
          })
        : getItemsEmby({
            data: {
              serverId: server.id,
              parentId: view.Id,
              limit: 30,
              sortBy: "DateCreated,SortName",
            },
          }),
  });
  if (!q.data || q.data.items.length === 0) return null;
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <Link
          to="/view/$id"
          params={{ id: view.Id }}
          className="group inline-flex items-baseline gap-2"
        >
          <h2 className="text-xl font-semibold tracking-tight group-hover:text-primary">
            {view.Name}
          </h2>
          <span className="text-sm text-muted-foreground transition group-hover:text-primary">
            See all →
          </span>
        </Link>
      </div>
      <Row items={q.data.items} server={server} kind="primary" />
    </section>
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
              className="overflow-hidden rounded-lg bg-muted ring-1 ring-border transition group-hover:ring-primary"
              style={{ aspectRatio: portrait ? "2/3" : "16/9" }}
            >
              {src ? (
                <img
                  src={src}
                  alt={cleanName(it.Name)}
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                  {cleanName(it.Name)}
                </div>
              )}
            </div>
            <p className="mt-2 line-clamp-1 text-sm font-medium">{cleanName(it.Name)}</p>
            {it.ProductionYear && (
              <p className="text-xs text-muted-foreground">{it.ProductionYear}</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function BackdropHero({
  items,
  server,
}: {
  items: any[];
  server: MediaServer;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items.length]);

  const current = items[idx] ?? items[0];
  const src = imageUrl(server, current, "Backdrop", { maxWidth: 1600 });
  if (!src) return null;

  return (
    <div className="relative h-[42vh] min-h-[280px] w-full overflow-hidden">
      {items.map((it, i) => {
        const s = imageUrl(server, it, "Backdrop", { maxWidth: 1600 });
        if (!s) return null;
        return (
          <img
            key={it.Id ?? i}
            src={s}
            alt=""
            aria-hidden={i !== idx}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              i === idx ? "opacity-100" : "opacity-0"
            }`}
          />
        );
      })}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-background/70 to-transparent"
      />
      <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Recently added
        </p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight drop-shadow-lg sm:text-4xl">
          {cleanName(current.Name)}
        </h2>
        {current.ProductionYear && (
          <p className="mt-1 text-sm text-muted-foreground">{current.ProductionYear}</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button asChild>
            <Link to="/item/$id" params={{ id: String(current.Id) }}>
              View details
            </Link>
          </Button>
          {items.length > 1 && (
            <div className="flex gap-1.5">
              {items.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Show item ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === idx ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
