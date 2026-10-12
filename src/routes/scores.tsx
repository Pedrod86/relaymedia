import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { getScores, LEAGUES, type ScoreGame, type ScoreTeam } from "@/lib/scores.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/scores")({
  head: () => ({
    meta: [
      { title: "Live Scores & Fixtures — Relay Media" },
      { name: "description", content: "Live scores, results and upcoming fixtures for football, NFL, NBA and more." },
      { property: "og:title", content: "Live Scores & Fixtures — Relay Media" },
      { property: "og:description", content: "Live scores, results and upcoming fixtures for football, NFL, NBA and more." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScoresPage,
});

function Team({ t }: { t: ScoreTeam }) {
  return (
    <div className="flex items-center gap-2">
      {t.logo ? <img src={t.logo} alt="" className="h-6 w-6 object-contain" /> : <span className="h-6 w-6" />}
      <span className={`flex-1 truncate text-sm ${t.winner ? "font-semibold" : ""}`}>{t.name}</span>
      <span className="w-8 text-right text-base font-semibold tabular-nums">{t.score ?? ""}</span>
    </div>
  );
}

function Game({ g }: { g: ScoreGame }) {
  const when = new Date(g.start).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div data-tv-card tabIndex={0} className="tv-card space-y-2 rounded-lg border bg-card p-3 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring">
      <div className="flex items-center justify-between text-xs">
        <span className={g.state === "in" ? "flex items-center gap-1 font-semibold text-destructive" : "text-muted-foreground"}>
          {g.state === "in" && <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />}
          {g.state === "pre" ? when : g.status}
        </span>
        {g.broadcast && <span className="truncate text-muted-foreground">{g.broadcast}</span>}
      </div>
      <Team t={g.home} />
      <Team t={g.away} />
      {g.venue && <p className="truncate text-xs text-muted-foreground">{g.venue}</p>}
    </div>
  );
}

function ScoresPage() {
  const [league, setLeague] = useState<string>(LEAGUES[0].id);
  const q = useQuery({
    queryKey: ["scores", league],
    queryFn: () => getScores({ data: { league } }),
    refetchInterval: 30_000,
  });
  const games = q.data?.games ?? [];
  const order = { in: 0, pre: 1, post: 2 } as const;
  const sorted = [...games].sort((a, b) => order[a.state] - order[b.state] || a.start.localeCompare(b.start));

  return (
    <main className="mx-auto min-h-screen max-w-5xl bg-background p-4 text-foreground">
      <div className="mb-4 flex items-center gap-2">
        <Link data-tv-card to="/iptv" className="tv-card rounded-md p-2 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring" aria-label="Back to Live TV">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">Live scores & fixtures</h1>
        <Button data-tv-card size="sm" variant="ghost" className="tv-card ms-auto" onClick={() => q.refetch()}>
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
        {LEAGUES.map((l) => (
          <button
            key={l.id}
            data-tv-card
            type="button"
            onClick={() => setLeague(l.id)}
            className={`tv-card whitespace-nowrap rounded-full border px-3 py-1 text-xs focus-visible:ring-4 focus-visible:ring-ring ${league === l.id ? "border-primary bg-primary/10" : "text-muted-foreground"}`}
          >
            {l.name}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading scores…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Couldn't load scores right now. Try again shortly.</p>
      ) : !sorted.length ? (
        <p className="text-sm text-muted-foreground">No matches this week for this league.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((g) => <Game key={g.id} g={g} />)}
        </div>
      )}
    </main>
  );
}
