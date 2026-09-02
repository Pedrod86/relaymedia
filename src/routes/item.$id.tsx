import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { embyGetItem, embyGetItems } from "@/lib/emby.functions";
import { plexGetItem } from "@/lib/plex.functions";
import { cleanName, imageUrl, ticksToTime, type MediaServer } from "@/lib/media-client";
import { useMediaServers } from "@/lib/use-servers";
import { Button } from "@/components/ui/button";
import { TrailerPreview } from "@/components/TrailerPreview";
import { useSavedItem } from "@/lib/use-saved-items";
import { toast } from "sonner";

import {
  checkItemPlayback,
  loadPlayerPrefs,
  probeCodecs,
  probeHdr,
  detectPlaybackEnv,
  WEB_ENV,
  NO_HDR,
  type CodecCap,
  type HdrSupport,
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
    <span className="rounded-full border bg-card/70 px-2.5 py-1 text-xs text-foreground/80">
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
  const [hdrSupport, setHdrSupport] = useState<HdrSupport>(NO_HDR);
  useEffect(() => {
    setPrefs(loadPlayerPrefs());
    void probeCodecs().then((c) => {
      setCaps(c);
      void probeHdr(c).then(setHdrSupport);
    });
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

  // Platform playback capability (MKV / E-AC3 / HDR10 via device decoders).
  const playbackEnv = useMemo(() => (typeof window === "undefined" ? WEB_ENV : detectPlaybackEnv()), []);

  const check = useMemo(
    () =>
      !isPlex && item && !isFolder && caps.length
        ? checkItemPlayback(item, caps, prefs, hdrSupport, playbackEnv)
        : null,
    [item, caps, prefs, isPlex, isFolder, hdrSupport, playbackEnv],
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
  const producers = people.filter((p) => p.Type === "Producer").map((p) => p.Name);


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

  const facts: Array<[string, string]> = (
    [
      ["Type", item.Type === "Series" ? "TV series" : item.Type],
      ["Released", item.PremiereDate ? new Date(item.PremiereDate).toLocaleDateString() : null],
      ["Year", item.ProductionYear ? String(item.ProductionYear) : null],
      ["Runtime", ticksToTime(item.RunTimeTicks) || null],
      ["Rated", item.OfficialRating],
      ["Rating", item.CommunityRating ? `★ ${Number(item.CommunityRating).toFixed(1)}/10` : null],
      ["Critics", item.CriticRating ? `${item.CriticRating}%` : null],
      ["Status", item.Status],
      ["Seasons", item.ChildCount != null && item.Type === "Series" ? String(item.ChildCount) : null],
      [
        "Episodes",
        item.RecursiveItemCount != null && item.Type === "Series"
          ? String(item.RecursiveItemCount)
          : null,
      ],
      ["Series", item.Type === "Episode" ? item.SeriesName : null],
      ["Genres", genres.length ? genres.slice(0, 4).join(", ") : null],
      ["Studio", studios.length ? studios.slice(0, 2).join(", ") : null],
      ["Cast size", cast.length ? `${people.filter((p) => p.Type === "Actor").length} credited` : null],
    ] as Array<[string, string | null | undefined]>
  )
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([l, v]) => [l, String(v)]);



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
                alt={`${cleanName(item.Name)} poster`}
                className="w-48 rounded-xl shadow-2xl ring-1 ring-border"
              />
            )}
            <div className="flex-1">
              <h1 className="text-4xl font-bold tracking-tight">{cleanName(item.Name)}</h1>
              {item.Taglines?.[0] && (
                <p className="mt-1 italic text-foreground/80">{item.Taglines[0]}</p>
              )}
              <p className="mt-2 text-sm font-medium text-foreground/90">{meta.join(" • ")}</p>

              {genres.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {genres.map((g) => (
                    <Chip key={g}>{g}</Chip>
                  ))}
                </div>
              )}

              {item.Overview && (
                <p className="mt-4 max-w-2xl text-foreground/90">{item.Overview}</p>
              )}

              {(directors.length > 0 || writers.length > 0 || studios.length > 0) && (
                <dl className="mt-4 space-y-1 text-sm">
                  {directors.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-foreground/70">Director</dt>
                      <dd>{directors.join(", ")}</dd>
                    </div>
                  )}
                  {writers.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-foreground/70">Writer</dt>
                      <dd>{writers.slice(0, 4).join(", ")}</dd>
                    </div>
                  )}
                  {studios.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="text-foreground/70">Studio</dt>
                      <dd>{studios.slice(0, 3).join(", ")}</dd>
                    </div>
                  )}
                </dl>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                {!isFolder && (
                  <Link to="/watch/$id" params={{ id: item.Id }}>
                    <Button size="lg">▶ Play</Button>
                  </Link>
                )}
                {isFolder && nextUp && (
                  <Link to="/watch/$id" params={{ id: nextUp.Id }}>
                    <Button size="lg">
                      ▶ Play{" "}
                      {nextUp.ParentIndexNumber != null && nextUp.IndexNumber != null
                        ? `S${nextUp.ParentIndexNumber}·E${nextUp.IndexNumber}`
                        : nextUp.IndexNumber != null
                          ? `episode ${nextUp.IndexNumber}`
                          : ""}
                    </Button>
                  </Link>
                )}
                {isFolder && !nextUp && childrenLoading && (
                  <Button size="lg" disabled>
                    Loading episodes…
                  </Button>
                )}
                <TrailerPreview server={server} itemId={item.Id} title={cleanName(item.Name)} />

                <SaveButtons server={server} item={item} />

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
                {check && (check.is4K || check.isHdr) && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      check.hdrPassthrough ? "bg-sky-500/15 text-sky-500" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {[
                      check.is4K ? "4K" : null,
                      check.isDolbyVision ? "Dolby Vision" : check.isHdr ? check.videoRange : null,
                      check.isHdr ? (check.hdrPassthrough ? "passthrough" : "tone-mapped") : null,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </span>
                )}

                <Link to="/settings" className="text-xs text-muted-foreground underline">
                  Player settings
                </Link>
              </div>

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

      {/* Storyline + details */}
      <section className="mx-auto max-w-6xl px-6 pt-12">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="mb-3 text-xl font-semibold">Storyline</h2>
            <p className="whitespace-pre-line leading-relaxed text-foreground/90">
              {item.Overview || "No synopsis available for this title yet."}
            </p>
            {(directors.length > 0 || writers.length > 0 || producers.length > 0) && (
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  ["Directed by", directors],
                  ["Written by", writers],
                  ["Produced by", producers],
                ]
                  .filter(([, v]) => (v as string[]).length > 0)
                  .map(([label, v]) => (
                    <div key={label as string}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm text-foreground/90">{(v as string[]).slice(0, 5).join(", ")}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Details
            </h3>
            <dl className="space-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-foreground/70">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Media / technical info */}

      {(videoStreams.length > 0 || audioStreams.length > 0) && (
        <section className="mx-auto max-w-6xl px-6 pt-12">
          <h2 className="mb-4 text-xl font-semibold">Media info</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Video</p>
              {videoStreams.map((s, i) => (
                <p key={s.Index ?? i} className="mt-1 text-sm">
                  {[
                    (s.Codec || "").toUpperCase(),
                    s.Width && s.Height ? `${s.Width}×${s.Height}` : null,
                    Number(s.Width ?? 0) >= 3400 ? "4K" : null,
                    s.DvProfile || String(s.VideoRangeType ?? "").toUpperCase().includes("DOVI")
                      ? `Dolby Vision${s.DvProfile ? ` p${s.DvProfile}` : ""}`
                      : (s.VideoRangeType ?? s.VideoRange) && (s.VideoRangeType ?? s.VideoRange) !== "SDR"
                        ? s.VideoRangeType ?? s.VideoRange
                        : null,
                    s.BitDepth ? `${s.BitDepth}-bit` : null,
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
              {audioStreams.map((s, i) => (
                <p key={s.Index ?? i} className="mt-1 text-sm">
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
              {subStreams.slice(0, 6).map((s, i) => (
                <p key={s.Index ?? i} className="mt-1 text-sm">
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
          <div className="flex gap-3 overflow-x-auto pb-3 sm:gap-4">
            {cast.map((p) => {
              const img = p.PrimaryImageTag
                ? imageUrl(
                    server,
                    { Id: p.Id, ImageTags: { Primary: p.PrimaryImageTag } },
                    "Primary",
                    { maxWidth: 300 },
                  )
                : null;
              return (
                <div
                  key={`${p.Id}-${p.Name}`}
                  className="w-24 shrink-0 text-center sm:w-28 md:w-32"
                >
                  {img ? (
                    <img
                      src={img}
                      alt={cleanName(p.Name)}
                      loading="lazy"
                      className="aspect-[3/4] w-full rounded-lg object-cover object-[center_15%] ring-1 ring-border"
                    />
                  ) : (
                    <div className="aspect-[3/4] w-full rounded-lg bg-muted" />
                  )}
                  <div className="px-0.5 pb-1">
                    <p className="mt-2 truncate text-xs font-medium">{cleanName(p.Name)}</p>
                    {p.Role && (
                      <p className="mt-0.5 truncate text-[11px] leading-tight text-foreground/70">
                        {p.Role}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isFolder && (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="mb-4 text-xl font-semibold">Episodes</h2>
          {childrenLoading && children.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading episodes…</p>
          )}
          {!childrenLoading && children.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No episodes found for this title on {server.name}.
            </p>
          )}
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
                      alt={cleanName(ep.Name)}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="p-3">
                    <p className="font-medium">
                      {ep.ParentIndexNumber != null && ep.IndexNumber != null
                        ? `S${ep.ParentIndexNumber}·E${ep.IndexNumber} — `
                        : ep.IndexNumber != null
                          ? `${ep.IndexNumber}. `
                          : ""}
                      {cleanName(ep.Name)}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {[ep.PremiereDate ? new Date(ep.PremiereDate).getFullYear() : null, ticksToTime(ep.RunTimeTicks)]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                    {ep.Overview && (
                      <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{ep.Overview}</p>
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

/** Favourite / watch-later toggles for the current title. */
function SaveButtons({ server, item }: { server: MediaServer; item: any }) {
  const fav = useSavedItem(server.id, "favourite", item);
  const later = useSavedItem(server.id, "later", item);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={fav.saved ? "default" : "outline"}
        size="lg"
        aria-pressed={fav.saved}
        onClick={() => {
          const on = fav.toggle();
          toast.success(on ? "Added to favourites" : "Removed from favourites");
        }}
      >
        {fav.saved ? "★ Favourited" : "☆ Favourite"}
      </Button>
      <Button
        variant={later.saved ? "default" : "outline"}
        size="lg"
        aria-pressed={later.saved}
        onClick={() => {
          const on = later.toggle();
          toast.success(on ? "Saved to watch later" : "Removed from watch later");
        }}
      >
        {later.saved ? "✓ Watch later" : "+ Watch later"}
      </Button>
    </div>
  );
}
