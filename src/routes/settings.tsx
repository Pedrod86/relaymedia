import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { embyGetViews, embyRefreshLibrary } from "@/lib/emby.functions";
import { plexGetViews, plexRefreshLibrary } from "@/lib/plex.functions";
import {
  listServers,
  loadActiveServer,
  setActiveServerId,
  removeServer,
  loadHiddenViews,
  saveHiddenViews,
  type MediaServer,
} from "@/lib/media-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { loadTheme, saveTheme, type ThemeName } from "@/lib/theme";
import { ServerIcon, ServerLabel } from "@/components/ServerIcon";

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
  const [servers, setServers] = useState<MediaServer[]>([]);
  const [active, setActive] = useState<MediaServer | null>(null);
  const [tick, setTick] = useState(0); // force re-render after mutations

  useEffect(() => {
    const list = listServers();
    if (list.length === 0) {
      navigate({ to: "/login" });
      return;
    }
    setServers(list);
    setActive(loadActiveServer());
  }, [navigate, tick]);

  if (!active) return null;

  function onSwitch(id: string) {
    setActiveServerId(id);
    setTick((t) => t + 1);
  }
  function onRemove(id: string) {
    if (!confirm("Remove this server from this device?")) return;
    removeServer(id);
    const remaining = listServers();
    if (remaining.length === 0) {
      navigate({ to: "/login" });
      return;
    }
    setTick((t) => t + 1);
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Media</p>
            <h1 className="text-lg font-semibold">Settings</h1>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/library">Back</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-6 py-8">
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
                      <Button size="sm" variant="outline" onClick={() => onSwitch(s.id)}>
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
        </section>

        <ThemePanel />

        <ActiveServerPanel server={active} />
      </div>
    </main>
  );
}

function ThemePanel() {
  const [theme, setTheme] = useState<ThemeName>("default");
  useEffect(() => setTheme(loadTheme()), []);

  const options: { id: ThemeName; label: string; desc: string }[] = [
    { id: "default", label: "Cinematic", desc: "Default dark theme tuned for video." },
    { id: "neon", label: "Neon", desc: "Magenta & cyan glow, cyberpunk vibes." },
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
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
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

function ActiveServerPanel({ server }: { server: MediaServer }) {
  const isPlex = server.kind === "plex";
  const getViewsEmby = useServerFn(embyGetViews);
  const getViewsPlex = useServerFn(plexGetViews);
  const refreshEmby = useServerFn(embyRefreshLibrary);
  const refreshPlex = useServerFn(plexRefreshLibrary);

  const views = useQuery({
    queryKey: ["settings-views", server.id],
    queryFn: () =>
      isPlex
        ? getViewsPlex({ data: { serverUrl: server.serverUrl, token: server.token } })
        : getViewsEmby({
            data: { serverUrl: server.serverUrl, token: server.token, userId: server.userId },
          }),
  });

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
        ? await refreshPlex({ data: { serverUrl: server.serverUrl, token: server.token } })
        : await refreshEmby({
            data: { serverUrl: server.serverUrl, token: server.token, userId: server.userId },
          });
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

      <section className="rounded-lg border p-6">
        <h2 className="text-base font-semibold">Hide categories</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Uncheck any library you don't want to see on the home screen for{" "}
          <span className="font-medium">{server.name}</span>.
        </p>

        {views.isLoading && <p className="mt-4 text-muted-foreground">Loading…</p>}
        {views.error && <p className="mt-4 text-destructive">Failed to load categories.</p>}

        <ul className="mt-4 divide-y">
          {views.data?.views.map((v) => {
            const visible = !hidden.has(v.Id);
            return (
              <li key={v.Id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{v.Name}</p>
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
    </>
  );
}
