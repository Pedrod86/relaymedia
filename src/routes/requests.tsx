import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  requestsCreate,
  requestsList,
  requestsSearch,
  requestsStatus,
  type SeerrResult,
} from "@/lib/requests.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLoader } from "@/components/BrandLoader";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Requests — Relay Media" },
      { name: "description", content: "Search for movies and TV shows and request them for your media server." },
      { property: "og:title", content: "Requests — Relay Media" },
      { property: "og:description", content: "Search for movies and TV shows and request them for your media server." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequestsPage,
});

const MEDIA_LABEL: Record<number, string> = { 2: "Requested", 3: "Processing", 4: "Partly available", 5: "Available" };
const REQ_LABEL: Record<number, string> = { 1: "Waiting for approval", 2: "Approved", 3: "Declined" };

function RequestsPage() {
  const statusFn = useServerFn(requestsStatus);
  const searchFn = useServerFn(requestsSearch);
  const listFn = useServerFn(requestsList);
  const createFn = useServerFn(requestsCreate);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [requested, setRequested] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const status = useQuery({ queryKey: ["requests-status"], queryFn: () => statusFn() });
  const connected = status.data?.connected === true;
  const search = useQuery({
    queryKey: ["requests-search", debounced],
    queryFn: () => searchFn({ data: { query: debounced } }),
    enabled: connected,
  });
  const mine = useQuery({ queryKey: ["requests-list"], queryFn: () => listFn(), enabled: connected });

  async function ask(r: SeerrResult) {
    const res = await createFn({ data: { mediaType: r.mediaType, mediaId: r.id } });
    if (res.ok) {
      toast.success(`Requested ${r.title}`);
      setRequested((s) => new Set(s).add(`${r.mediaType}-${r.id}`));
      mine.refetch();
    } else toast.error(res.error);
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/library" aria-label="Back to library"><ArrowLeft /></Link>
        </Button>
        <h1 className="text-2xl font-semibold">Requests</h1>
      </div>

      {status.isLoading ? (
        <BrandLoader label="Loading requests…" />
      ) : !connected ? (
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="mb-4">Connect Overseerr or Jellyseerr to start requesting films and shows.</p>
          <Button asChild><Link to="/settings" search={{ section: "integrations" }}>Open Settings</Link></Button>
        </div>
      ) : (
        <>
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for a movie or TV show…"
            className="mb-6 h-12 text-base"
          />
          <h2 className="mb-3 text-lg font-semibold">{debounced ? "Results" : "Trending"}</h2>
          {search.data && !search.data.ok && <p className="text-destructive">{search.data.error}</p>}
          <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {search.data?.results.map((r) => {
              const done = requested.has(`${r.mediaType}-${r.id}`);
              const label = done ? "Requested" : MEDIA_LABEL[r.status];
              return (
                <div key={`${r.mediaType}-${r.id}`} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                  <div className="aspect-[2/3] bg-muted">
                    {r.poster && <img src={r.poster} alt={r.title} loading="lazy" className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    <p className="line-clamp-2 text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.mediaType === "tv" ? "TV show" : "Movie"}{r.year ? ` · ${r.year}` : ""}</p>
                    {label ? (
                      <span className="mt-auto rounded bg-muted px-2 py-1 text-center text-xs">{label}</span>
                    ) : (
                      <Button data-tv-card size="sm" className="mt-auto" onClick={() => ask(r)}>Request</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mb-3 text-lg font-semibold">Recent requests</h2>
          {mine.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No requests yet.</p>}
          <div className="space-y-2">
            {mine.data?.items.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border bg-card p-2">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
                  {m.poster && <img src={m.poster} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.mediaType === "tv" ? "TV show" : "Movie"} · {m.mediaStatus === 5 ? "Available" : REQ_LABEL[m.requestStatus] ?? "Pending"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
