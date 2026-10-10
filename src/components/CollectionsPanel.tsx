// Settings > Collections: build your own lists, import lists from MDBList,
// TMDB, TVDB or Trakt, keep them synced, and see which titles you own.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Link2, Plus, RefreshCw, Search, Trash2, X, Check, Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/use-auth";
import { useMediaServers } from "@/lib/use-servers";
import { cleanName, type MediaServer } from "@/lib/media-client";
import { embySearch } from "@/lib/emby.functions";
import { plexSearch } from "@/lib/plex.functions";
import { requestsCreate } from "@/lib/requests.functions";
import {
  createCollection,
  deleteCollection,
  importCollection,
  listCollections,
  searchTitles,
  syncCollection,
  updateCollection,
  type Collection,
  type CollectionItem,
} from "@/lib/collections.functions";

const SOURCE_LABEL: Record<string, string> = {
  manual: "My collection",
  mdblist: "MDBList",
  tmdb: "TMDB",
  tvdb: "TVDB",
  trakt: "Trakt",
};
const DAY = 24 * 60 * 60 * 1000;

export function CollectionsPanel() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user)
    return (
      <section className="rounded-lg border p-6">
        <h3 className="text-base font-semibold">Collections</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to your Relay account so your collections follow you to every device.
        </p>
        <Button asChild className="mt-4" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </section>
    );
  return <CollectionsInner />;
}

export function HomeCollections() {
  const { user, isLoading } = useAuth();
  if (isLoading || !user) return null;
  return <HomeCollectionsInner userId={user.id} />;
}

function HomeCollectionsInner({ userId }: { userId: string }) {
  const list = useServerFn(listCollections);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["collections", userId], queryFn: () => list() });
  const [openId, setOpenId] = useState<string | null>(null);
  const collections = q.data?.collections ?? [];
  const open = collections.find((c) => c.id === openId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["collections"] });

  return (
    <section data-section-id="my-collections" aria-label="My collections" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">My collections</h2>
        <Button asChild variant="ghost" size="sm" data-tv-card className="tv-card shrink-0">
          <Link to="/settings" search={{ section: "collections" }}>Manage collections</Link>
        </Button>
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading collections…</p>}
      {q.isError && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">Couldn't load your collections.</p>
          <Button variant="outline" size="sm" data-tv-card onClick={() => q.refetch()}>Try again</Button>
        </div>
      )}
      {open ? (
        <CollectionView key={open.id} collection={open} onBack={() => setOpenId(null)} onChanged={refresh} />
      ) : (
        <>
          {!q.isLoading && !q.isError && !collections.length && <p className="text-sm text-muted-foreground">No collections yet.</p>}
          <div className="flex gap-4 overflow-x-auto pb-3">
            {collections.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                data-tv-card
                onClick={() => setOpenId(c.id)}
                className="tv-card h-auto w-56 shrink-0 flex-col items-stretch gap-3 overflow-hidden rounded-lg p-3 text-left focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-32 gap-1 overflow-hidden rounded-md bg-muted">
                  {c.items.slice(0, 3).map((it) => it.poster ? (
                    <img key={it.key} src={it.poster} alt={it.title} loading="lazy" className="h-full min-w-0 flex-1 object-cover" />
                  ) : <span key={it.key} className="grid min-w-0 flex-1 place-items-center"><Film className="size-6 text-muted-foreground" /></span>)}
                  {!c.items.length && <span className="grid w-full place-items-center"><Film className="size-8 text-muted-foreground" /></span>}
                </span>
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.items.length} titles · {SOURCE_LABEL[c.source]}</span>
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CollectionsInner() {
  const qc = useQueryClient();
  const list = useServerFn(listCollections);
  const create = useServerFn(createCollection);
  const importFn = useServerFn(importCollection);
  const syncFn = useServerFn(syncCollection);
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["collections", user?.id], queryFn: () => list() });
  const collections = q.data?.collections ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["collections"] });

  // Auto-sync linked lists once a day when this page is opened.
  useEffect(() => {
    const stale = collections.filter(
      (c) => c.source_url && c.auto_sync && (!c.synced_at || Date.now() - Date.parse(c.synced_at) > DAY),
    );
    if (!stale.length) return;
    Promise.allSettled(stale.map((c) => syncFn({ data: { id: c.id } }))).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dataUpdatedAt]);

  const onCreate = async () => {
    if (!newName.trim()) return;
    setBusy("create");
    try {
      const c = await create({ data: { name: newName.trim(), description: "" } });
      setNewName("");
      await refresh();
      setOpenId(c.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the collection");
    } finally {
      setBusy(null);
    }
  };

  const onImport = async () => {
    if (!url.trim()) return;
    setBusy("import");
    const r = await importFn({ data: { url: url.trim() } }).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Imported “${r.collection.name}” — ${r.collection.items.length} titles`);
    setUrl("");
    await refresh();
    setOpenId(r.collection.id);
  };

  const open = collections.find((c) => c.id === openId);
  if (open) return <CollectionView collection={open} onBack={() => setOpenId(null)} onChanged={refresh} />;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-6">
        <h3 className="text-base font-semibold">Create a collection</h3>
        <p className="mt-1 text-sm text-muted-foreground">Make your own list, then add any movie or show.</p>
        <div className="mt-3 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Friday movie night"
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
          />
          <Button onClick={onCreate} disabled={busy === "create" || !newName.trim()}>
            <Plus className="size-4" /> Create
          </Button>
        </div>
      </section>

      <section className="rounded-lg border p-6">
        <h3 className="text-base font-semibold">Import from a link</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a public list from MDBList, TMDB, TVDB or Trakt. Linked lists re-sync automatically every day.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mdblist.com/lists/user/list-name"
            onKeyDown={(e) => e.key === "Enter" && onImport()}
          />
          <Button onClick={onImport} disabled={busy === "import" || !url.trim()}>
            <Link2 className="size-4" /> {busy === "import" ? "Importing…" : "Import"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {["mdblist.com/lists/…", "themoviedb.org/list/…", "themoviedb.org/collection/…", "thetvdb.com/lists/…", "trakt.tv/users/…/lists/…"].map((s) => (
            <span key={s} className="rounded-full border px-2 py-0.5">{s}</span>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Your collections</p>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isLoading && !collections.length && (
          <p className="text-sm text-muted-foreground">No collections yet — create one or import a list above.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className="tv-card flex items-center gap-4 overflow-hidden rounded-2xl border bg-card/60 p-3 text-left transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-20 w-28 shrink-0 -space-x-6">
                {c.items.slice(0, 3).map((it) =>
                  it.poster ? (
                    <img key={it.key} src={it.poster} alt="" loading="lazy" className="h-20 w-14 rounded-md border object-cover shadow" />
                  ) : (
                    <div key={it.key} className="grid h-20 w-14 place-items-center rounded-md border bg-muted"><Film className="size-4" /></div>
                  ),
                )}
                {!c.items.length && <div className="grid h-20 w-14 place-items-center rounded-md border bg-muted"><Film className="size-4" /></div>}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {SOURCE_LABEL[c.source] ?? c.source} · {c.items.length} titles
                  {c.synced_at && ` · synced ${new Date(c.synced_at).toLocaleDateString()}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

type Match = { server: MediaServer; id: string } | null;

function useOwned(items: CollectionItem[]) {
  const { servers } = useMediaServers();
  const searchable = useMemo(() => servers.filter((s) => ["emby", "jellyfin", "plex", "silo"].includes(s.kind as string)), [servers]);
  const embyS = useServerFn(embySearch);
  const plexS = useServerFn(plexSearch);
  return useQuery({
    queryKey: ["collection-owned", searchable.map((s) => s.id).join(","), items.map((i) => i.key).join(",")],
    enabled: searchable.length > 0 && items.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const out: Record<string, Match> = {};
      const todo = items.slice(0, 150);
      const one = async (it: CollectionItem) => {
        const want = cleanName(it.title).toLowerCase();
        for (const sv of searchable) {
          try {
            const r: any = sv.kind === "plex"
              ? await plexS({ data: { serverId: sv.id, query: it.title } })
              : await embyS({ data: { serverId: sv.id, query: it.title } });
            const hit = (r?.items ?? []).find((x: any) => {
              const t = String(x.Type).toLowerCase();
              const okType = it.type === "movie" ? t === "movie" : t === "series" || t === "show";
              const yr = Number(x.ProductionYear);
              return okType && cleanName(x.Name).toLowerCase() === want && (!it.year || !yr || Math.abs(yr - it.year) <= 1);
            });
            if (hit) { out[it.key] = { server: sv, id: String(hit.Id) }; return; }
          } catch { /* try next server */ }
        }
        out[it.key] = null;
      };
      for (let i = 0; i < todo.length; i += 5) await Promise.all(todo.slice(i, i + 5).map(one));
      return out;
    },
  });
}

function CollectionView({ collection: c, onBack, onChanged }: { collection: Collection; onBack: () => void; onChanged: () => Promise<void> | void }) {
  const navigate = useNavigate();
  const { switchTo, active } = useMediaServers();
  const update = useServerFn(updateCollection);
  const del = useServerFn(deleteCollection);
  const sync = useServerFn(syncCollection);
  const search = useServerFn(searchTitles);
  const request = useServerFn(requestsCreate);
  const owned = useOwned(c.items);
  const [filter, setFilter] = useState<"all" | "have" | "missing">("all");
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CollectionItem[]>([]);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const manual = c.source === "manual";

  useEffect(() => {
    if (!manual || q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => {
      const r = await search({ data: { query: q.trim() } }).catch(() => null);
      setResults(r?.items ?? []);
    }, 400);
    return () => clearTimeout(t);
  }, [q, manual, search]);

  const setItems = async (items: CollectionItem[]) => {
    await update({ data: { id: c.id, items } });
    await onChanged();
  };

  const onSync = async () => {
    setSyncing(true);
    const r = await sync({ data: { id: c.id } }).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    setSyncing(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Synced — ${r.collection.items.length} titles`);
    await onChanged();
  };

  const onDelete = async () => {
    if (!confirm(`Delete “${c.name}”?`)) return;
    await del({ data: { id: c.id } });
    await onChanged();
    onBack();
  };

  const onRequest = async (it: CollectionItem) => {
    if (!it.tmdbId) return;
    const r = await request({ data: { mediaType: it.type, mediaId: it.tmdbId } });
    if (!r.ok) return toast.error(r.error);
    setRequested((s) => new Set(s).add(it.key));
    toast.success(`Requested ${it.title}`);
  };

  const openItem = (m: NonNullable<Match>) => {
    if (m.server.id !== active?.id) switchTo(m.server.id);
    navigate({ to: "/item/$id", params: { id: m.id } });
  };

  const map = owned.data ?? {};
  const haveCount = c.items.filter((i) => map[i.key]).length;
  const shown = c.items.filter((i) => filter === "all" || (filter === "have" ? map[i.key] : owned.data && !map[i.key]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button data-tv-card variant="ghost" size="icon" onClick={onBack} aria-label="Back to collections">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{c.name}</h3>
          <p className="text-xs text-muted-foreground">
            {SOURCE_LABEL[c.source]} · {c.items.length} titles
            {owned.data ? ` · ${haveCount} on your servers` : owned.isFetching ? " · checking your servers…" : ""}
          </p>
        </div>
        {c.source_url && (
          <Button data-tv-card variant="outline" size="sm" onClick={onSync} disabled={syncing}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} /> Sync now
          </Button>
        )}
        <Button data-tv-card variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>

      {c.source_url && (
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Auto-sync daily</p>
            <p className="truncate text-xs text-muted-foreground">{c.source_url}</p>
          </div>
          <Switch checked={c.auto_sync} onCheckedChange={async (v) => { await update({ data: { id: c.id, auto_sync: v } }); await onChanged(); }} />
        </div>
      )}

      {manual && (
        <div className="rounded-lg border p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input data-tv-card className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a movie or show…" />
          </div>
          {results.length > 0 && (
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {results.map((r) => {
                const has = c.items.some((i) => i.key === r.key);
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      disabled={has}
                      onClick={() => setItems([r, ...c.items])}
                      className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {r.poster ? <img src={r.poster} alt="" className="h-12 w-8 rounded object-cover" /> : <div className="h-12 w-8 rounded bg-muted" />}
                      <span className="flex-1 text-sm">{r.title} <span className="text-muted-foreground">{r.year ?? ""} · {r.type === "tv" ? "Show" : "Movie"}</span></span>
                      {has ? <Check className="size-4" /> : <Plus className="size-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {(["all", "have", "missing"] as const).map((f) => (
          <Button data-tv-card key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "have" ? "On my servers" : "Missing"}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((it) => {
          const m = map[it.key];
          const missing = owned.data && !m;
          return (
            <div key={it.key} className="group relative">
              <button
                type="button"
                data-tv-card
                onClick={() => m && openItem(m)}
                disabled={!m}
                className="tv-card block w-full overflow-hidden rounded-lg border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className={`aspect-[2/3] ${missing ? "opacity-50 grayscale" : ""}`}>
                  {it.poster ? (
                    <img src={it.poster} alt={it.title} loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center p-2 text-center text-xs">{it.title}</div>
                  )}
                </div>
                {missing && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Missing</span>
                )}
              </button>
              {manual && (
                <button
                  type="button"
                  aria-label={`Remove ${it.title}`}
                  onClick={() => setItems(c.items.filter((x) => x.key !== it.key))}
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/80 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              )}
              <p className="mt-1 truncate text-xs font-medium">{it.title}</p>
              <p className="text-[11px] text-muted-foreground">{it.year ?? ""}</p>
              {missing && it.tmdbId && (
                <Button data-tv-card size="sm" variant="outline" className="mt-1 h-7 w-full text-xs" disabled={requested.has(it.key)} onClick={() => onRequest(it)}>
                  {requested.has(it.key) ? "Requested" : "Request"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {!c.items.length && <p className="text-sm text-muted-foreground">This collection is empty.</p>}
    </div>
  );
}
