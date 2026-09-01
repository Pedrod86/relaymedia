import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { embyGetViews, embyGetItems, embyGetResume, embyGetLatest, embyRefreshLibrary } from "@/lib/emby.functions";
import { plexGetViews, plexGetItems, plexGetResume, plexGetLatest, plexRefreshLibrary } from "@/lib/plex.functions";
import {
  loadHiddenViews,
  loadSectionOrder,
  saveSectionOrder,
  applySectionOrder,
  imageUrl,
  itemTypesFor,
  cleanName,
  type MediaServer,
} from "@/lib/media-client";
import { MediaImage } from "@/components/MediaImage";
import { useMediaServers } from "@/lib/use-servers";
import { useProAccess } from "@/lib/use-pro";
import { isTvDevice } from "@/lib/platform";

import { toast } from "sonner";
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

const TV_MODE_KEY = "media:tv-mode";

function loadTvMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TV_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveTvMode(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TV_MODE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

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
  const navigate = useNavigate();
  const { isPro } = useProAccess();
  const [tvMode, setTvMode] = useState(false);
  useEffect(() => {
    // On a TV/box the 10-foot layout is the only usable one, so default to it
    // unless the user has explicitly chosen otherwise on this device.
    const stored = window.localStorage.getItem(TV_MODE_KEY);
    if (stored === null && isTvDevice()) {
      setTvMode(true);
      saveTvMode(true);
      return;
    }
    setTvMode(loadTvMode());
  }, []);


  // TV mode is a Pro feature — drop back to the standard layout if access ends.
  useEffect(() => {
    if (!isPro && tvMode) {
      setTvMode(false);
      saveTvMode(false);
    }
  }, [isPro, tvMode]);

  const toggleTv = () => {
    if (!isPro) {
      toast.info("TV mode is part of Relay Pro", {
        description: "Unlock it once for $1 — no subscription.",
        action: { label: "Unlock", onClick: () => navigate({ to: "/upgrade" }) },
      });
      return;
    }
    const next = !tvMode;
    setTvMode(next);
    saveTvMode(next);
  };

  const isPlex = server.kind === "plex";
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

  const sections = useMemo(() => {
    const list: {
      id: string;
      title: string;
      items: any[];
      kind: "primary" | "thumb";
      collectionType?: string;
    }[] = [];
    if (resume.data?.items.length) {
      list.push({ id: "resume", title: "Continue watching", items: resume.data.items, kind: "thumb" });
    }
    if (latest.data?.items.length) {
      list.push({ id: "latest", title: "Recently added", items: latest.data.items, kind: "primary" });
    }
    if (views.data) {
      views.data.views
        .filter((v) => !hidden.has(v.Id))
        .forEach((v) => {
          list.push({
            id: v.Id,
            title: v.Name,
            items: [],
            kind: "primary",
            collectionType: v.CollectionType,
          });
        });
    }

    return list;
  }, [resume.data, latest.data, views.data, hidden]);

  const topNav = (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:flex-wrap sm:justify-between sm:px-6 sm:py-4">
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
            {server.kind} · {server.name}
          </p>
          <h1 className="truncate text-base font-semibold sm:text-lg">Hi, {server.userName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {servers.length > 1 && (
            <select
              value={server.id}
              onChange={(e) => onSwitch(e.target.value)}
              className="hidden max-w-[9rem] rounded-md border bg-background px-2 py-1 text-sm sm:block"
              aria-label="Switch server"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.kind})
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" asChild aria-label="Search">
            <Link to="/search">
              <span>🔍</span>
              <span className="hidden sm:inline">Search</span>
            </Link>
          </Button>
          <Button
            variant={tvMode ? "default" : "outline"}
            size="sm"
            onClick={toggleTv}
            aria-pressed={tvMode}
            aria-label={tvMode ? "Exit TV mode" : "Enter TV mode"}
          >
            <span>📺</span>
            <span className="hidden sm:inline">{tvMode ? "Exit TV" : "TV mode"}</span>
            {!isPro && (
              <span className="hidden text-[10px] uppercase opacity-70 sm:inline">Pro</span>
            )}
          </Button>
          {isPro ? (
            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
              Pro
            </span>
          ) : (
            <Button size="sm" asChild>
              <Link to="/upgrade">
                <span className="sm:hidden">Pro</span>
                <span className="hidden sm:inline">Upgrade to Pro</span>
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild aria-label="Settings">
            <Link to="/settings">
              <span className="sm:hidden">⚙️</span>
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );


  if (tvMode) {
    return (
      <TVLayout
        server={server}
        topNav={topNav}
        sections={sections}
        backdropItems={backdropItems}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {topNav}

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

function TVLayout({
  server,
  topNav,
  sections,
  backdropItems,
}: {
  server: MediaServer;
  topNav: React.ReactNode;
  sections: {
    id: string;
    title: string;
    items: any[];
    kind: "primary" | "thumb";
    collectionType?: string;
  }[];

  backdropItems: any[];
}) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? "resume");
  const rowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const mainRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (sections.length && !sections.find((s) => s.id === activeSectionId)) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections, activeSectionId]);

  useEffect(() => {
    const cardsIn = (id: string) =>
      Array.from(rowsRef.current[id]?.querySelectorAll<HTMLElement>("[data-tv-card]") ?? []);

    const focusCard = (card: HTMLElement | undefined) => {
      if (!card) return false;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      return true;
    };

    const handler = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;

      const active = document.activeElement as HTMLElement | null;
      const card = active?.closest<HTMLElement>("[data-tv-card]") ?? null;
      const row = card?.closest<HTMLElement>("[data-section-id]") ?? null;
      const rowId = row?.dataset.sectionId ?? activeSectionId;
      const idx = sections.findIndex((s) => s.id === rowId);

      // Take over navigation entirely so focus moves one item at a time.
      e.preventDefault();

      if (!card) {
        // Nothing focused yet — enter the active row.
        const target = sections[idx >= 0 ? idx : 0]?.id ?? activeSectionId;
        setActiveSectionId(target);
        focusCard(cardsIn(target)[0]);
        return;
      }

      const cards = cardsIn(rowId);
      const pos = cards.indexOf(card);

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const nextPos = e.key === "ArrowRight" ? pos + 1 : pos - 1;
        if (nextPos >= 0 && nextPos < cards.length) focusCard(cards[nextPos]);
        return;
      }

      // Vertical: move one row, keeping the same column where possible.
      const dir = e.key === "ArrowDown" ? 1 : -1;
      for (let i = idx + dir; i >= 0 && i < sections.length; i += dir) {
        const nextId = sections[i]!.id;
        const nextCards = cardsIn(nextId);
        if (!nextCards.length) continue; // skip empty/unloaded rows only
        setActiveSectionId(nextId);
        focusCard(nextCards[Math.min(pos, nextCards.length - 1)]);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSectionId, sections]);


  const hero = backdropItems[0];

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background" ref={mainRef}>
      {topNav}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r bg-card/50 p-4 lg:flex">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sections
          </p>
          <nav className="space-y-1" aria-label="TV sections">
            <Link
              to="/search"
              className="tv-sidebar-item block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold outline-none"
            >
              🔍 Search
            </Link>
            {sections.map((s) => (

              <button
                key={s.id}
                type="button"
                data-focus={s.id === activeSectionId}
                className="tv-sidebar-item w-full rounded-lg px-3 py-3 text-left text-sm font-medium transition"
                onClick={() => {
                  setActiveSectionId(s.id);
                  rowsRef.current[s.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main scrollable area */}
        <div className="tv-scroll flex-1 overflow-y-auto px-6 py-6 lg:px-10">
          {hero && (
            <div className="relative mb-8 h-[32vh] min-h-[220px] w-full overflow-hidden rounded-2xl">
              <img
                src={imageUrl(server, hero, "Backdrop", { maxWidth: 1600 }) ?? undefined}
                alt=""
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-8">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Featured</p>
                <h2 className="mt-1 max-w-2xl text-3xl font-semibold tracking-tight lg:text-4xl">
                  {cleanName(hero.Name)}
                </h2>
                {hero.ProductionYear && (
                  <p className="mt-1 text-sm text-muted-foreground">{hero.ProductionYear}</p>
                )}
                <div className="mt-4">
                  <Button asChild>
                    <Link to="/item/$id" params={{ id: String(hero.Id) }}>
                      View details
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {sections.map((s) =>
            s.id === "resume" || s.id === "latest" ? (
              <TVSection
                key={s.id}
                id={s.id}
                title={s.title}
                items={s.items}
                server={server}
                kind={s.kind}
                isActive={s.id === activeSectionId}
                onRowRef={(el) => (rowsRef.current[s.id] = el)}
              />
            ) : (
              <TVLibrarySection
                key={s.id}
                id={s.id}
                title={s.title}
                collectionType={s.collectionType}
                server={server}
                isActive={s.id === activeSectionId}
                onRowRef={(el) => (rowsRef.current[s.id] = el)}
              />
            )
          )}
        </div>
      </div>
    </main>
  );
}

function TVSection({
  id,
  title,
  items,
  server,
  kind,
  isActive,
  onRowRef,
}: {
  id: string;
  title: string;
  items: any[];
  server: MediaServer;
  kind: "primary" | "thumb";
  isActive: boolean;
  onRowRef: (el: HTMLDivElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    onRowRef(rowRef.current);
  }, [onRowRef]);

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div
        ref={rowRef}
        data-section-id={id}
        className="tv-scroll flex gap-5 overflow-x-auto pb-4"
        data-active={isActive}
      >
        {items.map((it) => (
          <TVCard key={it.Id} item={it} server={server} kind={kind} />
        ))}
      </div>
    </section>
  );
}

function TVLibrarySection({
  id,
  title,
  collectionType,
  server,
  isActive,
  onRowRef,
}: {
  id: string;
  title: string;
  collectionType?: string;
  server: MediaServer;
  isActive: boolean;
  onRowRef: (el: HTMLDivElement | null) => void;
}) {
  const isPlex = server.kind === "plex";
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemsPlex = useServerFn(plexGetItems);
  const q = useQuery({
    queryKey: ["items", server.id, id],
    queryFn: () =>
      isPlex
        ? getItemsPlex({
            data: { serverId: server.id, parentId: id, limit: 30, sortBy: "addedAt:desc" },
          })
        : getItemsEmby({
            data: {
              serverId: server.id,
              parentId: id,
              limit: 30,
              sortBy: "DateCreated,SortName",
              // Same recursive query the standard layout uses, so folder-based
              // libraries return real movies/series that actually have artwork.
              recursive: true,
              includeItemTypes: itemTypesFor(collectionType),
            },
          }),
  });


  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    onRowRef(rowRef.current);
  }, [onRowRef]);

  if (!q.data || q.data.items.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        <Link
          to="/view/$id"
          params={{ id }}
          className="text-sm text-muted-foreground hover:text-primary"
        >
          See all →
        </Link>
      </div>
      <div
        ref={rowRef}
        data-section-id={id}
        className="tv-scroll flex gap-5 overflow-x-auto pb-4"
        data-active={isActive}
      >
        {q.data.items.map((it) => (
          <TVCard key={it.Id} item={it} server={server} kind="primary" />
        ))}
      </div>
    </section>
  );
}

function TVCard({
  item,
  server,
  kind,
}: {
  item: any;
  server: MediaServer;
  kind: "primary" | "thumb";
}) {
  const portrait = kind === "primary";
  const width = portrait ? 200 : 340;

  return (
    <Link
      to="/item/$id"
      params={{ id: item.Id }}
      data-tv-card
      tabIndex={0}
      className="tv-card group relative flex-shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border"
      style={{ width, aspectRatio: portrait ? "2/3" : "16/9" }}
    >
      <MediaImage
        server={server}
        item={item}
        type={portrait ? "Primary" : "Thumb"}
        maxWidth={500}
        alt={cleanName(item.Name)}
        className="h-full w-full object-cover"
        fallback={
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {cleanName(item.Name)}
          </div>
        }
      />

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3">
        <p className="truncate text-sm font-semibold text-white">{cleanName(item.Name)}</p>
        {item.ProductionYear && (
          <p className="text-xs text-white/80">{item.ProductionYear}</p>
        )}
      </div>
    </Link>
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
              // Recursive + explicit types so folder-organised libraries return
              // the actual movies/series (which have artwork) not folder rows.
              recursive: true,
              includeItemTypes: itemTypesFor(view.CollectionType),
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
              <MediaImage
                server={server}
                item={it}
                type={imgType}
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
