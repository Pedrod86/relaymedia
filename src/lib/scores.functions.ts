import { createServerFn } from "@tanstack/react-start";

export const LEAGUES = [
  { id: "soccer/eng.1", name: "Premier League" },
  { id: "soccer/eng.2", name: "Championship" },
  { id: "soccer/uefa.champions", name: "Champions League" },
  { id: "soccer/esp.1", name: "La Liga" },
  { id: "soccer/ita.1", name: "Serie A" },
  { id: "soccer/ger.1", name: "Bundesliga" },
  { id: "soccer/sco.1", name: "Scottish Prem" },
  { id: "football/nfl", name: "NFL" },
  { id: "basketball/nba", name: "NBA" },
  { id: "hockey/nhl", name: "NHL" },
  { id: "baseball/mlb", name: "MLB" },
] as const;

export type ScoreTeam = { name: string; short: string; logo: string | null; score: string | null; winner: boolean };
export type ScoreGame = {
  id: string;
  start: string;
  state: "pre" | "in" | "post";
  status: string;
  venue: string | null;
  broadcast: string | null;
  home: ScoreTeam;
  away: ScoreTeam;
};

export const getScores = createServerFn({ method: "GET" })
  .inputValidator((d: { league: string }) => {
    if (!LEAGUES.some((l) => l.id === d.league)) throw new Error("Unknown league");
    return d;
  })
  .handler(async ({ data }): Promise<{ games: ScoreGame[] }> => {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${data.league}/scoreboard`);
    if (!res.ok) throw new Error(`Scores unavailable (${res.status})`);
    const json: any = await res.json();
    const team = (c: any): ScoreTeam => ({
      name: String(c?.team?.displayName ?? "TBC"),
      short: String(c?.team?.abbreviation ?? ""),
      logo: c?.team?.logo ?? null,
      score: c?.score ?? null,
      winner: !!c?.winner,
    });
    const games = (json.events ?? []).map((e: any): ScoreGame => {
      const comp = e.competitions?.[0] ?? {};
      const cs = comp.competitors ?? [];
      return {
        id: String(e.id),
        start: String(e.date),
        state: e.status?.type?.state ?? "pre",
        status: String(e.status?.type?.shortDetail ?? ""),
        venue: comp.venue?.fullName ?? null,
        broadcast: comp.broadcasts?.[0]?.names?.join(", ") ?? null,
        home: team(cs.find((c: any) => c.homeAway === "home") ?? cs[0]),
        away: team(cs.find((c: any) => c.homeAway === "away") ?? cs[1]),
      };
    });
    return { games };
  });
