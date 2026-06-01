import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { embyGetViews, embyRefreshLibrary } from "@/lib/emby.functions";
import {
  loadSession,
  loadHiddenViews,
  saveHiddenViews,
  type EmbySession,
} from "@/lib/emby-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Emby" },
      { name: "description", content: "Manage server sync and visible categories." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<EmbySession | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      navigate({ to: "/login" });
      return;
    }
    setSession(s);
  }, [navigate]);

  if (!session) return null;
  return <SettingsContent session={session} />;
}

function SettingsContent({ session }: { session: EmbySession }) {
  const sessionArg = { serverUrl: session.serverUrl, token: session.token, userId: session.userId };
  const getViews = useServerFn(embyGetViews);
  const refresh = useServerFn(embyRefreshLibrary);

  const views = useQuery({
    queryKey: ["views", session.userId],
    queryFn: () => getViews({ data: sessionArg }),
  });

  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadHiddenViews()));
  const [refreshing, setRefreshing] = useState(false);

  function toggle(id: string, hide: boolean) {
    const next = new Set(hidden);
    if (hide) next.add(id);
    else next.delete(id);
    setHidden(next);
    saveHiddenViews([...next]);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      const res = await refresh({ data: sessionArg });
      if (res.ok) toast.success("Library sync started on server.");
      else toast.error(res.error);
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Emby</p>
            <h1 className="text-lg font-semibold">Settings</h1>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/library">Back</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-6 py-8">
        <section className="rounded-lg border p-6">
          <h2 className="text-base font-semibold">Server sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Trigger a full library scan on your Emby server. New and changed files
            will appear once the scan finishes.
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
            Uncheck any library you don't want to see on the home screen.
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
                      <p className="text-xs text-muted-foreground capitalize">
                        {v.CollectionType}
                      </p>
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
      </div>
    </main>
  );
}
