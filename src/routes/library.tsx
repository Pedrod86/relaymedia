import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { embyGetViews, embyGetItems, embyGetResume, embyGetLatest, embyRefreshLibrary, embyGetSuggestions } from "@/lib/emby.functions";
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
import { TorboxRow } from "@/components/TorboxRow";
import { useMediaServers } from "@/lib/use-servers";
import { useProAccess } from "@/lib/use-pro";
import { isTvDevice } from "@/lib/platform";
import { ServerSwitcher } from "@/components/ServerSwitcher";
import { useWatchHistory } from "@/lib/use-watch-history";
import { clearHistory, type HistoryEntry } from "@/lib/watch-history";
import { useSavedList } from "@/lib/use-saved-items";
import { usePersonalization } from "@/lib/personalization";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Home, Search, RefreshCw, ArrowUpDown, Tv, Settings, Menu, Cloud } from "lucide-react";


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
  const { prefs } = usePersonalization();
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
  const refreshEmby = useServerFn(embyRefreshLibrary);
  const refreshPlex = useServerFn(plexRefreshLibrary);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => setOrder(loadSectionOrder(server.id)), [server.id]);

  const hidden = useMemo(() => new Set(loadHiddenViews(server.id)), [server.id]);

  // ── Watch history & suggestions ──────────────────────────────────────────
  const { history, watched, genres } = useWatchHistory(server.id);
  const historyItems = useMemo(() => history.map(historyToItem), [history]);
  const watchedItems = useMemo(() => watched.map(historyToItem), [watched]);
  const favourites = useSavedList(server.id, "favourite");
  const watchLater = useSavedList(server.id, "later");
  const getSuggestions = useServerFn(embyGetSuggestions);
  const suggestions = useQuery({
    enabled: !isPlex && history.length > 0,
    queryKey: ["suggestions", server.id, genres.join(","), watched.length],
    queryFn: () =>
      getSuggestions({
        data: {
          serverId: server.id,
          genres,
          excludeIds: history.map((h) => h.id).slice(0, 60),
          limit: 24,
        },
      }),
    staleTime: 5 * 60_000,
  });

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

  // Ask the server to rescan, then pull everything on this page again.
  async function onRefresh() {
    setRefreshing(true);
    try {
      const res = isPlex
        ? await refreshPlex({ data: arg })
        : await refreshEmby({ data: arg });
      if (res.ok) toast.success("Server sync started — reloading your library.");
      else toast.error(res.error ?? "Could not start a server sync.");
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["views", server.id] }),
        queryClient.invalidateQueries({ queryKey: ["resume", server.id] }),
        queryClient.invalidateQueries({ queryKey: ["latest", server.id] }),
        queryClient.invalidateQueries({ queryKey: ["items", server.id] }),
      ]);
      setRefreshing(false);
    }
  }

  const backdropItems = useMemo(() => {
    if (!prefs.mediaBar) return [];
    const pool = latest.data?.items ?? [];
    return pool
      .filter((it: any) => imageUrl(server, it, "Backdrop", { maxWidth: 1600 }))
      .slice(0, prefs.mediaBarCount);
  }, [latest.data, server, prefs.mediaBar, prefs.mediaBarCount]);

  const sections = useMemo(() => {
    const list: {
      id: string;
      title: string;
      items: any[];
      kind: "primary" | "thumb";
      library?: boolean;
      collectionType?: string;
    }[] = [];
    if (resume.data?.items.length) {
      list.push({ id: "resume", title: "Continue watching", items: resume.data.items, kind: "thumb" });
    }
    if (latest.data?.items.length) {
      list.push({ id: "latest", title: "Recently added", items: latest.data.items, kind: "primary" });
    }
    if (favourites.items.length) {
      list.push({ id: "favourites", title: "Favourites", items: favourites.items, kind: "primary" });
    }
    if (watchLater.items.length) {
      list.push({ id: "later", title: "Watch later", items: watchLater.items, kind: "primary" });
    }
    if (historyItems.length) {
      list.push({ id: "history", title: "Watch history", items: historyItems, kind: "thumb" });
    }
    if (watchedItems.length) {
      list.push({
        id: "watched",
        title: "Previously watched",
        items: watchedItems,
        kind: "primary",
      });
    }
    if (suggestions.data?.items.length) {
      list.push({
        id: "suggested",
        title: genres.length ? `Because you watched ${genres[0]}` : "Suggested for you",
        items: suggestions.data.items,
        kind: "primary",
      });
    }
    if (views.data && prefs.showLibraryRows) {
      views.data.views
        .filter((v) => !hidden.has(v.Id))
        .forEach((v) => {
          list.push({
            id: v.Id,
            title: v.Name,
            items: [],
            kind: "primary",
            library: true,
            collectionType: v.CollectionType,
          });
        });
    }

    return applySectionOrder(list, order);
  }, [resume.data, latest.data, views.data, hidden, order, historyItems, watchedItems, suggestions.data, genres, favourites.items, watchLater.items, prefs.showLibraryRows]);

  function move(id: string, dir: -1 | 1) {
    const ids = sections.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setOrder(ids);
    saveSectionOrder(server.id, ids);
  }

  function resetOrder() {
    setOrder([]);
    saveSectionOrder(server.id, []);
  }

  const customizePanel = customizing ? (
    <div className="rounded-lg border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Content order</p>
          <p className="text-xs text-muted-foreground">
            Move rows up or down. Saved on this device.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearHistory(server.id);
                toast.success("Watch history cleared");
              }}
            >
              Clear history
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={resetOrder}>
            Reset
          </Button>
        </div>
      </div>
      <ul className="mt-3 divide-y">
        {sections.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate text-sm">{s.title}</span>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => move(s.id, -1)}
                disabled={i === 0}
                aria-label={`Move ${s.title} up`}
              >
                ↑
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => move(s.id, 1)}
                disabled={i === sections.length - 1}
                aria-label={`Move ${s.title} down`}
              >
                ↓
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  ) : null;


  const navItems = (
    <div className="mt-6 space-y-1.5">
      <div className="px-1 pb-2">
        <ServerSwitcher servers={servers} active={server} onSwitch={onSwitch} />
      </div>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        asChild
        onClick={() => setNavOpen(false)}
      >
        <Link to="/library">
          <Home className="size-5 text-primary" />
          Home
        </Link>
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        asChild
        onClick={() => setNavOpen(false)}
      >
        <Link to="/search">
          <Search className="size-5 text-primary" />
          Search
        </Link>
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        onClick={() => {
          setNavOpen(false);
          onRefresh();
        }}
        disabled={refreshing}
      >
        <RefreshCw className={`size-5 text-primary ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Refreshing…" : "Refresh servers"}
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        aria-pressed={customizing}
        onClick={() => {
          setNavOpen(false);
          setCustomizing((v) => !v);
        }}
      >
        <ArrowUpDown className="size-5 text-primary" />
        {customizing ? "Done customizing" : "Customize order"}
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        aria-pressed={tvMode}
        onClick={() => {
          setNavOpen(false);
          toggleTv();
        }}
      >
        <Tv className="size-5 text-primary" />
        {tvMode ? "Exit TV mode" : "TV mode"}
        {!isPro && (
          <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70">Pro</span>
        )}
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        asChild
        onClick={() => setNavOpen(false)}
      >
        <Link to="/settings" search={{ section: undefined }}>
          <Settings className="size-5 text-primary" />
          Settings
        </Link>
      </Button>
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-start gap-3 text-base"
        asChild
        onClick={() => setNavOpen(false)}
      >
        <Link to="/settings" search={{ section: "integrations" }}>
          <Cloud className="size-5 text-primary" />
          TorBox API
        </Link>
      </Button>
      <div className="px-1 pt-3">
        {isPro ? (
          <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
            Relay Pro
          </span>
        ) : (
          <Button className="w-full" asChild onClick={() => setNavOpen(false)}>
            <Link to="/upgrade">Upgrade to Pro</Link>
          </Button>
        )}
      </div>
    </div>
  );

  const topNav = (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Open menu">
              <Menu className="size-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[86vw] max-w-sm overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="truncate">{server.name}</SheetTitle>
              <SheetDescription className="truncate">
                {server.kind} · {server.userName}
              </SheetDescription>
            </SheetHeader>
            {navItems}
          </SheetContent>
        </Sheet>
        {prefs.showServerGreeting && (
          <div className="min-w-0">
            <p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
              {server.kind} · {server.name}
            </p>
            <h1 className="truncate text-base font-semibold sm:text-lg">Hi, {server.userName}</h1>
          </div>
        )}
        {prefs.quickActions && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" asChild aria-label="Search">
              <Link to="/search">
                <Search className="size-5" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label="Refresh"
              onClick={onRefresh}
            >
              <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" asChild aria-label="Settings">
              <Link to="/settings" search={{ section: undefined }}>
                <Settings className="size-5" />
              </Link>
            </Button>
          </div>
        )}
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
        customizePanel={customizePanel}
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
        {customizePanel}

        {views.isLoading && <p className="text-muted-foreground">Loading library…</p>}
        {views.error && (
          <p className="text-destructive">Failed to load library. Check your server and try again.</p>
        )}

        <TorboxRow />


        {sections.map((s) =>
          !s.library ? (
            <Section key={s.id} title={s.title}>
              <Row items={s.items} server={server} kind={s.kind} />
            </Section>
          ) : (
            <LibrarySection
              key={s.id}
              view={{ Id: s.id, Name: s.title, CollectionType: s.collectionType }}
              server={server}
            />
          ),
        )}
      </div>

    </main>
  );
}

function TVLayout({
  server,
  topNav,
  sections,
  backdropItems,
  customizePanel,
}: {
  server: MediaServer;
  topNav: React.ReactNode;
  customizePanel?: React.ReactNode;
  sections: {
    id: string;
    title: string;
    items: any[];
    kind: "primary" | "thumb";
    library?: boolean;
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

  // Remembered horizontal position (card centre, in row-content coordinates) so
  // travelling up/down through short rows still lands on the expected column.
  const columnRef = useRef<number | null>(null);

  useEffect(() => {
    /** Rows in visual order, straight from the DOM so it can never disagree. */
    const rowEls = () =>
      Array.from(
        mainRef.current?.querySelectorAll<HTMLElement>("[data-section-id]") ?? [],
      );

    const cardsOf = (row: HTMLElement) =>
      Array.from(row.querySelectorAll<HTMLElement>("[data-tv-card]"));

    /** Centre of a card within its (scrollable) row, independent of scroll. */
    const centreOf = (card: HTMLElement) => card.offsetLeft + card.offsetWidth / 2;

    const focusCard = (card: HTMLElement | undefined | null) => {
      if (!card) return false;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      const row = card.closest<HTMLElement>("[data-section-id]");
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      const id = row?.dataset.sectionId;
      if (id) setActiveSectionId(id);
      return true;
    };

    /** Card in `row` closest to the remembered column. */
    const nearest = (row: HTMLElement) => {
      const cards = cardsOf(row);
      if (!cards.length) return null;
      const want = columnRef.current;
      if (want == null) return cards[0];
      let best = cards[0]!;
      let bestD = Math.abs(centreOf(best) - want);
      for (const c of cards.slice(1)) {
        const d = Math.abs(centreOf(c) - want);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    };

    /** Focus the header / sidebar and scroll the page back to the top. */
    const focusChrome = () => {
      mainRef.current
        ?.querySelector<HTMLElement>(".tv-scroll")
        ?.scrollTo({ top: 0, behavior: "smooth" });
      const chrome = mainRef.current?.querySelector<HTMLElement>(
        "header a, header button, aside a, aside button",
      );
      chrome?.focus({ preventScroll: true });
    };

    const handler = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;

      const active = document.activeElement as HTMLElement | null;
      const card = active?.closest<HTMLElement>("[data-tv-card]") ?? null;
      const rows = rowEls().filter((r) => cardsOf(r).length);

      if (!card) {
        // Focus sits in the header / sidebar: leave sideways moves to the
        // browser, and only take over when stepping down into the rows.
        if (e.key === "ArrowDown" && rows.length) {
          e.preventDefault();
          columnRef.current = null;
          focusCard(cardsOf(rows[0]!)[0]);
        }
        return;
      }

      // Take over navigation entirely so focus moves one item at a time.
      e.preventDefault();

      const row = card.closest<HTMLElement>("[data-section-id]");
      if (!row) return;
      const cards = cardsOf(row);
      const pos = cards.indexOf(card);
      const rowIdx = rows.indexOf(row);

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = cards[e.key === "ArrowRight" ? pos + 1 : pos - 1];
        if (next) {
          columnRef.current = centreOf(next);
          focusCard(next);
        } else if (e.key === "ArrowLeft") {
          // At the start of a row: step out to the section list / header.
          const sideItem = mainRef.current?.querySelector<HTMLElement>(
            'aside [data-focus="true"], aside button, aside a',
          );
          if (sideItem) sideItem.focus({ preventScroll: true });
        }
        return;
      }

      // Vertical: one row at a time, landing on the nearest column.
      if (columnRef.current == null) columnRef.current = centreOf(card);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const nextRow = rows[rowIdx + dir];
      if (nextRow) {
        focusCard(nearest(nextRow));
        return;
      }

      // Past the first row: hop up into the header so the top stays reachable.
      if (dir === -1) focusChrome();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);




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
          {customizePanel && <div className="mb-6">{customizePanel}</div>}
          {hero && (
            <div className="isolate z-0 mb-8 overflow-hidden rounded-2xl">
              <BackdropHero items={backdropItems} server={server} />
            </div>
          )}

          {sections.map((s) =>
            !s.library ? (
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

      {typeof item.__progress === "number" && item.__progress > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-10 h-1.5 bg-black/60">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, item.__progress)}%` }}
          />
        </div>
      )}

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
  const { prefs } = usePersonalization();
  const effectiveKind = prefs.imageType === "thumb" ? "thumb" : kind;
  return (
    <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
      {items.map((it) => {
        const portrait = effectiveKind === "primary";
        const imgType = effectiveKind === "thumb" ? "Thumb" : "Primary";
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
              {prefs.showProgress && typeof it.__progress === "number" && it.__progress > 1 && (
                <div className="relative -mt-1 h-1 w-full bg-black/50">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, it.__progress)}%` }}
                  />
                </div>
              )}
            </div>

            {prefs.showTitles && (
              <p className="mt-2 line-clamp-1 text-sm font-medium">{cleanName(it.Name)}</p>
            )}
            {prefs.showYears && it.ProductionYear && (
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
  const { prefs } = usePersonalization();
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % items.length),
      Math.max(3, prefs.mediaBarRotateSeconds) * 1000,
    );
    return () => clearInterval(t);
  }, [items.length, prefs.mediaBarRotateSeconds]);

  if (!items.length) return null;
  const current = items[idx] ?? items[0];
  const backdrop = imageUrl(server, current, "Backdrop", { maxWidth: 1600 });

  return (
    <div className="relative isolate z-0 w-full overflow-hidden pb-6 pt-4">
      {/* Ambient glow from the featured artwork */}
      {backdrop && (
        <img
          key={backdrop}
          src={backdrop}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-3xl transition-opacity duration-1000"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-background/20 to-background"
      />

      {/* Floating poster reel */}
      <div className="relative z-10 flex h-[46vh] min-h-[300px] items-center justify-center">
        {items.map((it, i) => {
          const offset = i - idx;
          const abs = Math.abs(offset);
          if (abs > 2) return null;
          const isActive = offset === 0;
          return (
            <button
              key={it.Id ?? i}
              type="button"
              aria-label={cleanName(it.Name)}
              aria-hidden={!isActive}
              onClick={() => (isActive ? undefined : setIdx(i))}
              style={{
                transform: `translateX(${offset * 62}%) scale(${isActive ? 1 : abs === 1 ? 0.82 : 0.68})`,
                zIndex: 10 - abs,
                opacity: isActive ? 1 : abs === 1 ? 0.55 : 0.25,
                filter: isActive ? undefined : "blur(1px)",
              }}
              className="absolute aspect-[2/3] h-full max-h-[360px] overflow-hidden rounded-2xl border border-border/40 bg-card shadow-2xl transition-all duration-700 ease-out"
            >
              <MediaImage
                server={server}
                item={it}
                type="Primary"
                maxWidth={500}
                alt={cleanName(it.Name)}
                className="h-full w-full object-cover"
                fallback={
                  <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                    {cleanName(it.Name)}
                  </span>
                }
              />
            </button>
          );
        })}
        {/* Glow ring behind the active poster */}
        <div
          aria-hidden
          className="pointer-events-none absolute h-[70%] w-[46%] rounded-full bg-primary/25 blur-3xl"
        />
      </div>

      {/* Caption */}
      <div className="relative z-10 mx-auto mt-5 flex max-w-xl flex-col items-center px-6 text-center">
        <Link
          to="/item/$id"
          params={{ id: String(current.Id) }}
          className="text-2xl font-semibold uppercase tracking-wide text-primary drop-shadow-lg sm:text-3xl"
        >
          {cleanName(current.Name)}
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          {[current.ProductionYear, current.OfficialRating].filter(Boolean).join(" · ")}
        </p>
        {items.length > 1 && (
          <div className="mt-4 flex items-center gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show item ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/** History entries keep an artwork snapshot — reshape it into a library item. */
function historyToItem(e: HistoryEntry) {
  return {
    ...(e.item as Record<string, unknown>),
    Id: e.id,
    Name: e.name,
    ProductionYear: e.year,
    __progress: e.progress,
    __completed: e.completed,
  } as any;
}
