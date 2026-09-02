import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Info, Lock, Palette, PlayCircle, Search, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { embyGetViews, embyGetViewCounts, embyRefreshLibrary } from "@/lib/emby.functions";
import { plexGetViews, plexGetViewCounts, plexRefreshLibrary } from "@/lib/plex.functions";
import { removeMediaServer, signOutAllServers } from "@/lib/servers.functions";
import {
  clearActiveServerId,
  clearHiddenViews,
  itemTypesFor,
  loadHiddenViews,
  saveHiddenViews,
  type MediaServer,
} from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { useProAccess } from "@/lib/use-pro";
import { FREE_SERVER_LIMIT, PRO_SERVER_LIMIT } from "@/lib/limits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { loadTheme, saveTheme, type ThemeName } from "@/lib/theme";
import { ServerIcon, ServerLabel } from "@/components/ServerIcon";
import { PlayerSettingsPanel } from "@/components/PlayerSettingsPanel";
import { DevicesPanel } from "@/components/DevicesPanel";
import { AccountPanel } from "@/components/AccountPanel";
import { TorboxPanel } from "@/components/TorboxPanel";
import { TraktPanel } from "@/components/TraktPanel";
import { DiscordPanel } from "@/components/DiscordPanel";
import { AiPicksPanel } from "@/components/AiPicksPanel";
import { PersonalizationHub } from "@/components/personalization/PersonalizationHub";



export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Media" },
      { name: "description", content: "Manage your media servers, sync, and visible categories." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const { servers, active, isLoading, switchTo, refresh } = useMediaServers();
  const { isPro } = useProAccess();
  const removeServerFn = useServerFn(removeMediaServer);
  const signOutAllFn = useServerFn(signOutAllServers);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isLoading && servers.length === 0) navigate({ to: "/login" });
  }, [isLoading, servers.length, navigate]);

  if (!active) return null;

  async function onRemove(id: string) {
    if (!confirm("Disconnect this server? Its saved sign-in will be deleted.")) return;
    // Removing deletes the credential from the server-side vault, which is the
    // only place the access token ever lived.
    const res = await removeServerFn({ data: { serverId: id } });
    clearHiddenViews(id);
    if (res.servers.length === 0) {
      clearActiveServerId();
      navigate({ to: "/login" });
      return;
    }
    if (active?.id === id) switchTo(res.servers[0]!.id);
    refresh();
  }

  async function onSignOutAll() {
    if (!confirm("Sign out of every server on this device?")) return;
    await signOutAllFn({});
    clearActiveServerId();
    navigate({ to: "/login" });
  }


  const sections: {
    id: string;
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    keywords: string;
    render: () => ReactNode;
  }[] = [
    {
      id: "account",
      title: "Account & Security",
      desc: "Authentication, servers, and connected devices",
      icon: Lock,
      keywords: "account security sign in sign out servers devices emby plex jellyfin relay pro",
      render: () => (
        <>
          <section className="rounded-lg border p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold">Your servers</h2>
              <Button asChild size="sm">
                <Link to="/login">+ Add server</Link>
              </Button>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              Switch between connected <ServerLabel kind="emby" />,{" "}
              <ServerLabel kind="jellyfin" /> or <ServerLabel kind="plex" /> servers, or remove ones you no longer use.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {isPro ? (
                <>Up to {PRO_SERVER_LIMIT} connected servers — free right now.</>
              ) : (
                <>
                  Free plan: {FREE_SERVER_LIMIT} connected server.{" "}
                  <Link to="/upgrade" className="underline">
                    Unlock up to {PRO_SERVER_LIMIT} with Relay Pro
                  </Link>
                  .
                </>
              )}
            </p>

            <ul className="mt-4 divide-y">
              {servers.map((s) => {
                const isActive = s.id === active.id;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.name}{" "}
                        <span className="ml-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                          <ServerIcon kind={s.kind} size={12} />
                          {s.kind}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{s.serverUrl}</p>
                      <p className="truncate text-xs text-muted-foreground">Signed in as {s.userName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isActive ? (
                        <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">Active</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => switchTo(s.id)}>
                          Use
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => onRemove(s.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t pt-4">
              <Button variant="outline" size="sm" onClick={onSignOutAll}>
                Sign out of all servers
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Sign-ins are stored encrypted on the server and are never readable by
                scripts in your browser.
              </p>
            </div>
          </section>
          <AccountPanel />
          <DevicesPanel />
        </>
      ),
    },
    {
      id: "personalization",
      title: "Personalization",
      desc: "Theme, home rows, and library visibility",
      icon: Palette,
      keywords: "theme neon cyber minimal appearance categories hide libraries rows",
      render: () => (
        <PersonalizationHub
          themePanel={<ThemePanel />}
          librariesPanel={<ActiveServerPanel server={active} only="categories" />}
        />
      ),
    },
    {
      id: "playback",
      title: "Playback",
      desc: "Audio/video decoding, codecs, and AFR",
      icon: PlayCircle,
      keywords: "playback player hardware software decoder codec afr subtitles hdr",
      render: () => <PlayerSettingsPanel />,
    },
    {
      id: "integrations",
      title: "Integrations",
      desc: "AI picks, Discord, Trakt, TorBox, and library sync",
      icon: Share2,
      keywords: "integrations ai discord trakt torbox scrobble sync refresh library",
      render: () => (
        <>
          <AiPicksPanel serverId={active.id} />
          <DiscordPanel />
          <TraktPanel />
          <TorboxPanel />
          <ActiveServerPanel server={active} only="sync" />
        </>
      ),
    },
    {
      id: "about",
      title: "About",
      desc: "App version, legal information, and credits",
      icon: Info,
      keywords: "about version legal credits licence",
      render: () => <AboutPanel />,
    },
  ];

  const open = sections.find((s) => s.id === openId) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sections.filter((s) => `${s.title} ${s.desc} ${s.keywords}`.toLowerCase().includes(q))
    : sections;

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          {open ? (
            <Button variant="ghost" size="icon" onClick={() => setOpenId(null)} aria-label="Back">
              <ChevronLeft className="size-6" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" asChild aria-label="Close settings">
              <Link to="/library">
                <X className="size-6" />
              </Link>
            </Button>
          )}
          <h1 className="truncate text-2xl font-bold tracking-wide sm:text-3xl">
            {open ? open.title : "Settings"}
          </h1>
        </div>
      </header>

      {open ? (
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">{open.render()}</div>
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              className="h-14 w-full rounded-full border bg-card pl-14 pr-5 text-base tracking-wide outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="mt-6 space-y-4">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpenId(s.id)}
                className="tv-card flex w-full items-center gap-4 rounded-2xl border bg-card/60 p-5 text-left transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-14 shrink-0 place-items-center rounded-xl border bg-accent/40">
                  <s.icon className="size-7 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{s.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{s.desc}</span>
                </span>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-10 text-center text-muted-foreground">No settings match “{query}”.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function AboutPanel() {
  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">About Relay</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">App</dt>
          <dd className="font-medium">Relay Media</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-medium">1.0</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Supported servers</dt>
          <dd className="font-medium">Emby · Jellyfin · Plex</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Relay is a client for your own media servers. All artwork and media belong to
        their respective owners. Sign-ins are stored encrypted server-side.
      </p>
    </section>
  );
}


function ThemePanel() {
  const [theme, setTheme] = useState<ThemeName>("default");
  useEffect(() => setTheme(loadTheme()), []);

  const options: { id: ThemeName; label: string; desc: string }[] = [
    { id: "default", label: "Cinematic", desc: "Default dark theme tuned for video." },
    { id: "neon", label: "Neon", desc: "Magenta & cyan glow, cyberpunk vibes." },
    { id: "cyber", label: "Cyber", desc: "Deep violet with cyan & pink neon type." },
    { id: "minimal", label: "Minimal", desc: "Clean light theme, no neon." },
  ];

  function pick(t: ThemeName) {
    setTheme(t);
    saveTheme(t);
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Theme</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose how the app looks. Saved on this device.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {options.map((o) => {
          const active = theme === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o.id)}
              className={`rounded-lg border p-4 text-left transition ${
                active ? "border-primary ring-2 ring-primary/50" : "hover:bg-accent"
              }`}
            >
              <p className="font-medium">{o.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ActiveServerPanel({ server, only }: { server: MediaServer; only?: "sync" | "categories" }) {
  const isPlex = server.kind === "plex";
  const getViewsEmby = useServerFn(embyGetViews);
  const getViewsPlex = useServerFn(plexGetViews);
  const getCountsEmby = useServerFn(embyGetViewCounts);
  const getCountsPlex = useServerFn(plexGetViewCounts);
  const refreshEmby = useServerFn(embyRefreshLibrary);
  const refreshPlex = useServerFn(plexRefreshLibrary);

  const views = useQuery({
    queryKey: ["settings-views", server.id],
    queryFn: () =>
      isPlex
        ? getViewsPlex({ data: { serverId: server.id } })
        : getViewsEmby({ data: { serverId: server.id } }),
  });

  const viewList = views.data?.views;
  const counts = useQuery({
    queryKey: ["settings-view-counts", server.id, viewList?.map((v) => v.Id).join(",")],
    enabled: !!viewList?.length,
    queryFn: () =>
      isPlex
        ? getCountsPlex({
            data: { serverId: server.id, views: viewList!.map((v) => ({ id: v.Id })) },
          })
        : getCountsEmby({
            data: {
              serverId: server.id,
              views: viewList!.map((v) => ({
                id: v.Id,
                includeItemTypes: itemTypesFor(v.CollectionType),
              })),
            },
          }),
  });

  const totalItems = Object.values<number>(counts.data?.counts ?? {}).reduce((a, b) => a + b, 0);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadHiddenViews(server.id)));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setHidden(new Set(loadHiddenViews(server.id)));
  }, [server.id]);

  function toggle(id: string, hide: boolean) {
    const next = new Set(hidden);
    if (hide) next.add(id);
    else next.delete(id);
    setHidden(next);
    saveHiddenViews(server.id, [...next]);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      const res = isPlex
        ? await refreshPlex({ data: { serverId: server.id } })
        : await refreshEmby({ data: { serverId: server.id } });
      if (res.ok) toast.success("Library sync started.");
      else toast.error(res.error);
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      {only !== "categories" && (
      <section className="rounded-lg border p-6">
        <h2 className="text-base font-semibold">Server sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger a full library scan on <span className="font-medium">{server.name}</span>.
          New and changed files appear once the scan finishes.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Starting…" : "Refresh library"}
          </Button>
          <Button
            variant="outline"
            onClick={() => views.refetch()}
            disabled={views.isFetching}
          >
            Reload categories
          </Button>
        </div>
      </section>
      )}

      {only !== "sync" && (
      <section className="rounded-lg border p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Hide categories</h2>
          <p className="text-xs text-muted-foreground">
            {counts.isLoading
              ? "Counting library…"
              : totalItems > 0
                ? `${totalItems.toLocaleString()} items total`
                : ""}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Uncheck any library you don't want to see on the home screen for{" "}
          <span className="font-medium">{server.name}</span>.
        </p>

        {views.isLoading && <p className="mt-4 text-muted-foreground">Loading…</p>}
        {views.error && <p className="mt-4 text-destructive">Failed to load categories.</p>}

        <ul className="mt-4 divide-y">
          {views.data?.views.map((v) => {
            const visible = !hidden.has(v.Id);
            const count = counts.data?.counts?.[v.Id];
            return (
              <li key={v.Id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">
                    {v.Name}
                    <span className="ml-2 rounded-full border px-2 py-0.5 align-middle text-xs font-normal text-muted-foreground">
                      {count === undefined ? (counts.isLoading ? "…" : "—") : count.toLocaleString()}
                    </span>
                  </p>
                  {v.CollectionType && (
                    <p className="text-xs capitalize text-muted-foreground">{v.CollectionType}</p>
                  )}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={visible}
                    onCheckedChange={(c) => toggle(v.Id, !c)}
                  />
                  <span className="text-muted-foreground">Show</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      )}
    </>
  );
}
