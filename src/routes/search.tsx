import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { embySearch } from "@/lib/emby.functions";
import { plexSearch } from "@/lib/plex.functions";
import { imageUrl, cleanName, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { activeProfile, kidsSafe } from "@/lib/profiles";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search your library — Relay Media" },
      {
        name: "description",
        content:
          "TV-friendly search across your Emby, Jellyfin and Plex libraries using the remote keyboard.",
      },
      { property: "og:title", content: "Search your library — Relay Media" },
      {
        property: "og:description",
        content: "Find movies and TV episodes fast with an on-screen remote keyboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SearchPage,
});

const ROWS = [
  "ABCDEFG".split(""),
  "HIJKLMN".split(""),
  "OPQRSTU".split(""),
  "VWXYZ'".split("").concat([" "]),
  "0123456789".split(""),
];

function SearchPage() {
  const navigate = useNavigate();
  const { active, isLoading } = useMediaServers();

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <SearchContent server={active} />;
}

type Hit = { item: any; server: MediaServer; sources: { server: MediaServer; id: string }[] };

function SearchContent({ server }: { server: MediaServer }) {
  const navigate = useNavigate();
  const { servers: allServers, switchTo } = useMediaServers();
  const searchable = useMemo(
    () => allServers.filter((s) => ["emby", "jellyfin", "plex", "silo"].includes(s.kind as string)),
    [allServers],
  );
  const searchEmby = useServerFn(embySearch);
  const searchPlex = useServerFn(plexSearch);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Federated search: every connected server at once; the same title on
  // several servers collapses into one card with a source picker.
  const results = useQuery({
    queryKey: ["search-all", searchable.map((s) => s.id).join(","), debounced],
    enabled: debounced.length >= 2 && searchable.length > 0,
    queryFn: async () => {
      const settled = await Promise.allSettled(
        searchable.map(async (sv) => {
          const r: any =
            sv.kind === "plex"
              ? await searchPlex({ data: { serverId: sv.id, query: debounced } })
              : await searchEmby({ data: { serverId: sv.id, query: debounced } });
          return (r?.items ?? []).map((item: any) => ({ item, server: sv }));
        }),
      );
      const kids = activeProfile().kids;
      const map = new Map<string, Hit>();
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const { item, server: sv } of s.value) {
          if (kids && !kidsSafe(item)) continue;
          const key = `${String(item.Type).toLowerCase()}|${cleanName(item.Name).toLowerCase()}|${item.ProductionYear ?? ""}|${item.SeriesName ?? ""}|${item.ParentIndexNumber ?? ""}|${item.IndexNumber ?? ""}`;
          const hit = map.get(key);
          if (hit) hit.sources.push({ server: sv, id: String(item.Id) });
          else map.set(key, { item, server: sv, sources: [{ server: sv, id: String(item.Id) }] });
        }
      }
      return { hits: [...map.values()], failed: settled.filter((s) => s.status === "rejected").length };
    },
  });

  const open = (sv: MediaServer, id: string) => {
    if (sv.id !== server.id) switchTo(sv.id);
    navigate({ to: "/item/$id", params: { id: String(id) } });
  };

  const press = useCallback((ch: string) => setQuery((q) => (q + ch).slice(0, 100)), []);
  const backspace = useCallback(() => setQuery((q) => q.slice(0, -1)), []);

  // Remote-friendly typing: letters/digits from a physical or virtual remote
  // keyboard append even when the text field isn't focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      if (e.key === "Backspace" && !typing) {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === "Escape") {
        setQuery("");
        return;
      }
      if (!typing && e.key.length === 1 && /[a-z0-9 ']/i.test(e.key)) {
        e.preventDefault();
        press(e.key.toUpperCase() === e.key ? e.key : e.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [press, backspace]);

  const hits = useMemo(() => results.data?.hits ?? [], [results.data]);

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              All servers · {searchable.length} connected
            </p>
            <h1 className="text-lg font-semibold">Search</h1>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/library">Back to library</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[420px_1fr]">
        {/* On-screen remote keyboard */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, 100))}
              placeholder="Search movies and episodes"
              aria-label="Search query"
              className="w-full rounded-lg border bg-background px-4 py-4 text-2xl font-semibold tracking-wide outline-none focus-visible:ring-4 focus-visible:ring-ring"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Use the arrow keys and OK on your remote, or just start typing.
            </p>
          </div>

          <div className="space-y-2" role="group" aria-label="On-screen keyboard">
            {ROWS.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => press(ch)}
                    aria-label={ch === " " ? "Space" : ch}
                    className="tv-card h-14 flex-1 rounded-lg border bg-card text-xl font-semibold outline-none focus-visible:ring-4 focus-visible:ring-ring"
                  >
                    {ch === " " ? "␣" : ch}
                  </button>
                ))}
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={backspace}
                className="tv-card h-14 flex-1 rounded-lg border bg-card text-base font-semibold outline-none focus-visible:ring-4 focus-visible:ring-ring"
              >
                ⌫ Delete
              </button>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="tv-card h-14 flex-1 rounded-lg border bg-card text-base font-semibold outline-none focus-visible:ring-4 focus-visible:ring-ring"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div ref={gridRef}>
          {debounced.length < 2 && (
            <p className="text-muted-foreground">Type at least two characters to search.</p>
          )}
          {results.isFetching && <p className="text-muted-foreground">Searching…</p>}
          {results.error && (
            <p className="text-destructive">Search failed. Check your server connection.</p>
          )}
          {debounced.length >= 2 && !results.isFetching && hits.length === 0 && (
            <p className="text-muted-foreground">No matches for “{debounced}”.</p>
          )}

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">
            {hits.map(({ item: it, server: sv, sources }) => {
              const isEpisode = it.Type === "Episode" || it.Type === "episode";
              const src = imageUrl(sv, it, isEpisode ? "Thumb" : "Primary", { maxWidth: 500 });
              return (
                <div key={`${sv.id}-${it.Id}`}>
                <Link
                  to="/item/$id"
                  params={{ id: String(it.Id) }}
                  onClick={(e) => {
                    e.preventDefault();
                    open(sv, it.Id);
                  }}
                  data-tv-card
                  tabIndex={0}
                  className="tv-card group overflow-hidden rounded-xl outline-none"
                >
                  <div
                    className="overflow-hidden rounded-xl bg-muted ring-1 ring-border"
                    style={{ aspectRatio: isEpisode ? "16/9" : "2/3" }}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={cleanName(it.Name)}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
                        {cleanName(it.Name)}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-1 text-base font-semibold">{cleanName(it.Name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {isEpisode && it.SeriesName
                      ? `${cleanName(it.SeriesName)}${
                          it.ParentIndexNumber != null && it.IndexNumber != null
                            ? ` · S${it.ParentIndexNumber}·E${it.IndexNumber}`
                            : ""
                        }`
                      : [it.Type, it.ProductionYear].filter(Boolean).join(" · ")}
                  </p>
                </Link>
                {sources.length > 1 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {sources.map((s2) => (
                      <button
                        key={s2.server.id}
                        type="button"
                        onClick={() => open(s2.server, s2.id)}
                        className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {s2.server.name}
                      </button>
                    ))}
                  </div>
                )}
                {sources.length === 1 && searchable.length > 1 && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{sv.name}</p>
                )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
