import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { embyGetItem, embyGetItems } from "@/lib/emby.functions";
import { plexGetItem } from "@/lib/plex.functions";
import { imageUrl, ticksToTime, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { Button } from "@/components/ui/button";
import {
  checkItemPlayback,
  loadPlayerPrefs,
  probeCodecs,
  type CodecCap,
  type PlayerPrefs,
  DEFAULT_PREFS,
} from "@/lib/player-prefs";

export const Route = createFileRoute("/item/$id")({
  head: () => ({
    meta: [
      { title: "Title details — Media" },
      { name: "description", content: "Cast, ratings, runtime and media details for this movie or TV show." },
      { property: "og:title", content: "Title details — Media" },
      { property: "og:description", content: "Cast, ratings, runtime and media details." },
    ],
  }),
  component: ItemPage,
});

function ItemPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const { active, isLoading } = useMediaServers();

  useEffect(() => {
    if (!isLoading && !active) navigate({ to: "/login" });
  }, [isLoading, active, navigate]);

  if (!active) return null;
  return <Detail key={active.id} server={active} id={id} />;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function Detail({ server, id }: { server: MediaServer; id: string }) {
  const isPlex = server.kind === "plex";
  const getItemEmby = useServerFn(embyGetItem);
  const getItemsEmby = useServerFn(embyGetItems);
  const getItemPlex = useServerFn(plexGetItem);

  const [prefs, setPrefs] = useState<PlayerPrefs>(DEFAULT_PREFS);
  const [caps, setCaps] = useState<CodecCap[]>([]);
  useEffect(() => {
    setPrefs(loadPlayerPrefs());
    void probeCodecs().then(setCaps);
  }, []);

  const itemQ = useQuery({
    queryKey: ["item", server.id, id],
    queryFn: () =>
      isPlex
        ? getItemPlex({ data: { serverId: server.id, itemId: id } })
        : getItemEmby({ data: { serverId: server.id, itemId: id } }),
  });

  const item = itemQ.data?.item as any;
  const isFolder = item?.IsFolder || item?.Type === "Series" || item?.Type === "Season";

  const isSeries = item?.Type === "Series";

  // Emby/Jellyfin: a Series gets its full flat episode list (recursive) so a
  // single Play button can start at episode 1; a Season lists its own children.
  const childrenQ = useQuery({
    enabled: !!item && isFolder && !isPlex,
    queryKey: ["children", server.id, id, isSeries],
    queryFn: () =>
      getItemsEmby({
        data: isSeries
          ? {
              serverId: server.id,
              parentId: id,
              limit: 200,
              recursive: true,
              includeItemTypes: "Episode",
              sortBy: "ParentIndexNumber,IndexNumber,SortName",
            }
          : { serverId: server.id, parentId: id, limit: 200, sortBy: "IndexNumber,SortName" },
      }),
  });

  // Plex: children of a show are seasons, so drill one level for a playable episode.
  const plexChildren: any[] = isPlex ? (item?._children ?? []) : [];
  const firstPlexFolder = plexChildren.find((c) => c.IsFolder);
  const plexGrandChildrenQ = useQuery({
    enabled: isPlex && !!firstPlexFolder && !plexChildren.some((c) => !c.IsFolder),
    queryKey: ["plex-children", server.id, firstPlexFolder?.Id],
    queryFn: () => getItemPlex({ data: { serverId: server.id, itemId: firstPlexFolder!.Id } }),
  });

  const check = useMemo(
    () => (!isPlex && item && !isFolder && caps.length ? checkItemPlayback(item, caps, prefs) : null),
    [item, caps, prefs, isPlex, isFolder],
  );

  if (!item) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const backdrop = imageUrl(server, item, "Backdrop", { maxWidth: 1920 });
  const poster = imageUrl(server, item, "Primary", { maxWidth: 400 });
  const children: any[] = isPlex ? plexChildren : (childrenQ.data?.items ?? []);
  const childrenLoading = isPlex ? false : childrenQ.isLoading;

  // First playable episode: prefer a partially-watched one, else the first.
  const episodePool: any[] = isPlex
    ? (plexChildren.some((c) => !c.IsFolder)
        ? plexChildren
        : ((plexGrandChildrenQ.data?.item as any)?._children ?? []))
    : children;
  const playable = episodePool.filter((c: any) => !c.IsFolder);
  const nextUp =
    playable.find((c: any) => (c.UserData?.PlaybackPositionTicks ?? 0) > 0) ??
    playable.find((c: any) => !c.UserData?.Played) ??
    playable[0];


  const genres: string[] = item.Genres ?? [];
  const studios: string[] = (item.Studios ?? []).map((s: any) => s?.Name ?? s).filter(Boolean);
  const people: any[] = item.People ?? [];
  const cast = people.filter((p) => p.Type === "Actor").slice(0, 18);
  const directors = people.filter((p) => p.Type === "Director").map((p) => p.Name);
  const writers = people.filter((p) => p.Type === "Writer").map((p) => p.Name);

  const source = item.MediaSources?.[0];
  const streams: any[] = source?.MediaStreams ?? item.MediaStreams ?? [];
  const videoStreams = streams.filter((s) => s.Type === "Video");
  const audioStreams = streams.filter((s) => s.Type === "Audio");
  const subStreams = streams.filter((s) => s.Type === "Subtitle");

  const meta = [
    item.Type === "Episode" && item.SeriesName,
    item.Type === "Episode" && item.ParentIndexNumber != null && item.IndexNumber != null
      ? `S${item.ParentIndexNumber}·E${item.IndexNumber}`
      : null,
    item.ProductionYear,
    item.OfficialRating,
    ticksToTime(item.RunTimeTicks),
    item.CommunityRating ? `★ ${Number(item.CommunityRating).toFixed(1)}` : null,
    item.CriticRating ? `${item.CriticRating}% critics` : null,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-background">
      <div className="relative">
        {backdrop && (
          <div
            className="absolute inset-0 h-[60vh]"
            style={{
              backgroundImage: `linear-gradient(to bottom, transparent 0%, oklch(0.16 0.02 270 / 0.6) 50%, var(--background) 100%), url("${backdrop}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}
        <div className="relative mx-auto max-w-6xl px-6 pt-8">
          <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to library
          </Link>
          <div className="mt-32 flex flex-col gap-8 md:flex-row md:items-end">
            {poster && (
              <img
                src={poster}
                alt={`${item.Name} poster`}
                className="w-48 rounded-xl shadow-2xl ring-1 ring-border"
              />
            )}
            <div className="flex-1">
              <h1 className="text-4xl font-bold tracking-tight">{item.Name}</h1>
              {item.Taglines?.[0] && (
                <p className="mt-1 italic text-muted-foreground">{item.Taglines[0]}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{meta.join(" • ")}</p>

              {genres.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {genres.map((g) => (
                    <Chip key={g}>{g}</Chip>
                  ))}
                </div>
              )}

              {item.Overview && (
                <p className="mt-4 max-w-2xl text-muted-foreground">{item.Overview}</p>
              )}

              {(directors.length > 0 || writers.length > 0 || studios.length > 0) && (
                <dl className="mt-4 space-y-1 text-sm">
                  {directors.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Director</dt>
                      <dd>{directors.join(", ")}</dd>
                    </div>
                  )}
                  {writers.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Writer</dt>
                      <dd>{writers.slice(0, 4).join(", ")}</dd>
                    </div>
                  )}
                  {studios.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Studio</dt>
                      <dd>{studios.slice(0, 3).join(", ")}</dd>
                    </div>
                  )}
                </dl>
              )}

              {!isFolder && (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link to="/watch/$id" params={{ id: item.Id }}>
                    <Button size="lg">▶ Play</Button>
                  </Link>
                  {check && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${
                        check.canDirectPlay
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-amber-500/15 text-amber-500"
                      }`}
                    >
                      {check.canDirectPlay ? "Direct play supported" : "Will transcode"}
                    </span>
                  )}
                  <Link to="/settings" className="text-xs text-muted-foreground underline">
                    Player settings
                  </Link>
                </div>
              )}
              {check && check.notes.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {check.notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Media / technical info */}
      {(videoStreams.length > 0 || audioStreams.length > 0) && (
        <section className="mx-auto max-w-6xl px-6 pt-12">
          <h2 className="mb-4 text-xl font-semibold">Media info</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Video</p>
              {videoStreams.map((s) => (
                <p key={s.Index} className="mt-1 text-sm">
                  {[
                    (s.Codec || "").toUpperCase(),
                    s.Width && s.Height ? `${s.Width}×${s.Height}` : null,
                    s.VideoRange && s.VideoRange !== "SDR" ? s.VideoRange : null,
                    s.AverageFrameRate ? `${Math.round(s.AverageFrameRate)}fps` : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              ))}
              {source?.Container && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Container {String(source.Container).toUpperCase()}
                </p>
              )}
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Audio</p>
              {audioStreams.map((s) => (
                <p key={s.Index} className="mt-1 text-sm">
                  {[
                    (s.Codec || "").toUpperCase(),
                    s.ChannelLayout,
                    s.Language,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              ))}
              {audioStreams.length === 0 && <p className="mt-1 text-sm text-muted-foreground">—</p>}
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Subtitles</p>
              {subStreams.length === 0 && <p className="mt-1 text-sm text-muted-foreground">None</p>}
              {subStreams.slice(0, 6).map((s) => (
                <p key={s.Index} className="mt-1 text-sm">
                  {s.DisplayTitle || s.Language || `Track ${s.Index}`}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Cast */}
      {cast.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pt-12">
          <h2 className="mb-4 text-xl font-semibold">Cast</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {cast.map((p) => {
              const img = p.PrimaryImageTag
                ? imageUrl(
                    server,
                    { Id: p.Id, ImageTags: { Primary: p.PrimaryImageTag } },
                    "Primary",
                    { maxWidth: 200 },
                  )
                : null;
              return (
                <div key={`${p.Id}-${p.Name}`} className="w-28 shrink-0 text-center">
                  {img ? (
                    <img
                      src={img}
                      alt={p.Name}
                      loading="lazy"
                      className="aspect-[2/3] w-full rounded-lg object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="aspect-[2/3] w-full rounded-lg bg-muted" />
                  )}
                  <p className="mt-2 truncate text-xs font-medium">{p.Name}</p>
                  {p.Role && (
                    <p className="truncate text-[11px] text-muted-foreground">{p.Role}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isFolder && children.length > 0 && (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="mb-4 text-xl font-semibold">Episodes</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((ep: any) => {
              const epImg = imageUrl(server, ep, "Primary", { maxWidth: 600 });
              return (
                <Link
                  key={ep.Id}
                  to={ep.IsFolder ? "/item/$id" : "/watch/$id"}
                  params={{ id: ep.Id }}
                  className="group overflow-hidden rounded-lg border bg-card transition hover:border-primary"
                >
                  {epImg && (
                    <img
                      src={epImg}
                      alt={ep.Name}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="p-3">
                    <p className="font-medium">
                      {ep.IndexNumber ? `${ep.IndexNumber}. ` : ""}
                      {ep.Name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[ep.PremiereDate ? new Date(ep.PremiereDate).getFullYear() : null, ticksToTime(ep.RunTimeTicks)]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                    {ep.Overview && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ep.Overview}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
