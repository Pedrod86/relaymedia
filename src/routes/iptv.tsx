import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { CalendarClock, Loader2, Radio, RefreshCw, Search, Trash2, Tv, X } from "lucide-react";

import { iptvChannels, iptvGuide, listIptvServers, removeIptvServer } from "@/lib/iptv.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerIcon } from "@/components/ServerIcon";
import { isTvDevice } from "@/lib/platform";
import { media3Available, media3Play } from "@/lib/native-player";

export const Route = createFileRoute("/iptv")({
  head: () => ({
    meta: [
      { title: "Live TV — Relay Media" },
      {
        name: "description",
        content:
          "Watch your IPTV channels and playlists — Xtream Codes or M3U — with a full TV guide inside Relay Media.",
      },
      { property: "og:title", content: "Live TV — Relay Media" },
      {
        property: "og:description",
        content:
          "Watch your IPTV channels and playlists — Xtream Codes or M3U — with a full TV guide inside Relay Media.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IptvPage,
});

type Channel = {
  id: string;
  name: string;
  group: string;
  logo: string | null;
  play: string;
  kind: "live" | "movie";
  epgId: string | null;
};

type Programme = { start: number; stop: number; title: string; desc: string | null };
type Guide = Record<string, Programme[]>;

const STREAM_PATH = "/api/public/iptv-stream";

function clockTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function nowNext(guide: Guide, epgId: string | null, now: number) {
  if (!epgId) return { now: null as Programme | null, next: null as Programme | null };
  const list = guide[epgId] ?? [];
  const current = list.find((p) => p.start <= now && p.stop > now) ?? null;
  const next = list.find((p) => p.start > now) ?? null;
  return { now: current, next };
}

function IptvPage() {
  const listFn = useServerFn(listIptvServers);
  const channelsFn = useServerFn(iptvChannels);
  const guideFn = useServerFn(iptvGuide);
  const removeFn = useServerFn(removeIptvServer);
  const queryClient = useQueryClient();

  const [serverId, setServerId] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<Channel | null>(null);
  const [guideFor, setGuideFor] = useState<Channel | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const providers = useQuery({
    queryKey: ["iptv-servers"],
    queryFn: async () => (await listFn({})).servers,
    staleTime: 30_000,
  });

  const list = providers.data ?? [];
  const activeId = serverId ?? list[0]?.id ?? null;

  const channels = useQuery({
    queryKey: ["iptv-channels", activeId],
    enabled: Boolean(activeId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await channelsFn({ data: { serverId: activeId! } });
      if (!res.ok) throw new Error(res.error);
      return res as { channels: Channel[]; groups: string[] };
    },
  });

  const guide = useQuery({
    queryKey: ["iptv-guide", activeId],
    enabled: Boolean(activeId),
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const res = await guideFn({ data: { serverId: activeId! } });
      if (!res.ok) return { guide: {} as Guide, available: false };
      return { guide: (res.guide ?? {}) as Guide, available: Boolean(res.available) };
    },
  });

  const epg = guide.data?.guide ?? {};
  const groups = channels.data?.groups ?? [];
  const visible = useMemo(() => {
    const all = channels.data?.channels ?? [];
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => (group === "All" ? true : c.group === group))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .slice(0, 600);
  }, [channels.data, group, search]);

  async function onRemove(id: string) {
    await removeFn({ data: { serverId: id } });
    setServerId(null);
    setPlaying(null);
    setGuideFor(null);
    queryClient.invalidateQueries({ queryKey: ["iptv-servers"] });
  }

  return (
    <main className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur-xl">
        <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground">
          ← Library
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Radio className="h-5 w-5 text-primary" /> Live TV
        </h1>
        <div className="ms-auto flex items-center gap-2">
          <Link to="/login" search={{ kind: "iptv" }}>
            <Button size="sm" variant="secondary">
              Add provider
            </Button>
          </Link>
        </div>
      </header>

      <div className="px-4 py-4">
        {providers.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading providers…</p>
        ) : list.length === 0 ? (
          <div className="mx-auto max-w-md rounded-2xl border bg-card/60 p-8 text-center">
            <Tv className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">No IPTV provider yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a provider with Xtream Codes details or an M3U playlist link.
            </p>
            <Link to="/login" search={{ kind: "iptv" }}>
              <Button className="mt-4">Add IPTV provider</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {list.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    s.id === activeId
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <button
                    type="button"
                    className="flex items-center gap-2"
                    onClick={() => {
                      setServerId(s.id);
                      setGroup("All");
                      setPlaying(null);
                      setGuideFor(null);
                    }}
                  >
                    <ServerIcon kind="iptv" size={16} />
                    {s.name}
                    <span className="text-xs text-muted-foreground">
                      {s.mode === "m3u" ? "M3U" : "Xtream"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => onRemove(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {channels.isLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading channels…
              </p>
            )}
            {channels.error && (
              <p className="text-sm text-destructive" role="alert">
                {(channels.error as Error).message}
              </p>
            )}

            {channels.data && (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Search channels"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {channels.data.channels.length} total
                  </span>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span>
                    {guide.isFetching
                      ? "Loading TV guide…"
                      : guide.data?.available
                        ? "TV guide loaded — tap a channel name to see what's on."
                        : "No TV guide available for this provider."}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs"
                    disabled={guide.isFetching}
                    onClick={() => void guide.refetch()}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${guide.isFetching ? "animate-spin" : ""}`} />
                    Refresh guide
                  </Button>
                </div>

                <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                  {["All", ...groups].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroup(g)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                        group === g
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>

                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visible.map((c) => {
                    const { now: current, next } = nowNext(epg, c.epgId, now);
                    const progress =
                      current && current.stop > current.start
                        ? Math.min(
                            100,
                            Math.max(0, ((now - current.start) / (current.stop - current.start)) * 100),
                          )
                        : null;
                    return (
                      <li
                        key={c.id}
                        className="rounded-xl border bg-card/60 p-3 transition hover:border-primary"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setPlaying(c)}
                            className="shrink-0 focus:outline-none"
                            aria-label={`Play ${c.name}`}
                          >
                            {c.logo ? (
                              <img
                                src={c.logo}
                                alt=""
                                loading="lazy"
                                className="h-12 w-12 rounded object-contain"
                              />
                            ) : (
                              <span className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                                <Tv className="h-5 w-5 text-muted-foreground" />
                              </span>
                            )}
                          </button>
                          <div className="min-w-0 flex-1 text-left">
                            <button
                              type="button"
                              onClick={() => setPlaying(c)}
                              className="line-clamp-1 text-sm font-medium hover:text-primary focus:outline-none"
                            >
                              {c.name}
                            </button>
                            {current ? (
                              <>
                                <p className="line-clamp-1 text-xs text-muted-foreground">
                                  {clockTime(current.start)} · {current.title}
                                </p>
                                {progress !== null && (
                                  <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                                    <span
                                      className="block h-full rounded-full bg-primary"
                                      style={{ width: `${progress}%` }}
                                    />
                                  </span>
                                )}
                                {next && (
                                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground/80">
                                    Next {clockTime(next.start)} · {next.title}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground">{c.group}</p>
                            )}
                            {c.epgId && (epg[c.epgId]?.length ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setGuideFor(c)}
                                className="mt-1 text-[11px] text-primary hover:underline"
                              >
                                Full guide
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {visible.length === 0 && (
                  <p className="text-sm text-muted-foreground">No channels match that search.</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {guideFor && (
        <GuideSheet
          channel={guideFor}
          programmes={guideFor.epgId ? (epg[guideFor.epgId] ?? []) : []}
          now={now}
          onClose={() => setGuideFor(null)}
          onPlay={() => {
            setPlaying(guideFor);
            setGuideFor(null);
          }}
        />
      )}

      {playing && (
        <ChannelPlayer
          channel={playing}
          programme={nowNext(epg, playing.epgId, now).now}
          onClose={() => setPlaying(null)}
        />
      )}
    </main>
  );
}

function GuideSheet({
  channel,
  programmes,
  now,
  onClose,
  onPlay,
}: {
  channel: Channel;
  programmes: Programme[];
  now: number;
  onClose: () => void;
  onPlay: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/70 sm:items-center sm:justify-center">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border bg-card p-4 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="truncate text-base font-semibold">{channel.name}</h2>
          <Button size="sm" className="ms-auto" onClick={onPlay}>
            Watch
          </Button>
          <button type="button" onClick={onClose} aria-label="Close guide" className="p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-2">
          {programmes.map((p) => {
            const live = p.start <= now && p.stop > now;
            return (
              <li
                key={`${p.start}-${p.title}`}
                className={`rounded-lg border p-3 ${live ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <p className="text-sm font-medium">
                  {clockTime(p.start)} – {clockTime(p.stop)}
                  {live && <span className="ms-2 text-xs text-primary">On now</span>}
                </p>
                <p className="text-sm">{p.title}</p>
                {p.desc && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{p.desc}</p>
                )}
              </li>
            );
          })}
          {programmes.length === 0 && (
            <li className="text-sm text-muted-foreground">No guide data for this channel.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ChannelPlayer({
  channel,
  programme,
  onClose,
}: {
  channel: Channel;
  programme: Programme | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const src = `${STREAM_PATH}?t=${encodeURIComponent(channel.play)}`;

  // On Android the device's own player (ExoPlayer/Media3) handles live streams
  // far more smoothly than the browser, so hand playback over when available.
  const playNative = useCallback(async () => {
    const absolute = new URL(src, window.location.origin).toString();
    return media3Play({ url: absolute, title: channel.name });
  }, [src, channel.name]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await media3Available();
      if (cancelled) return;
      setNativeReady(available);
      if (available && (await playNative())) onClose();
    })();
    return () => {
      cancelled = true;
    };
  }, [playNative, onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setStalled(false);
    let hls: Hls | null = null;
    let stallTimer: number | undefined;
    const isHls = channel.kind === "live" || /\.m3u8/i.test(src);

    if (isHls && Hls.isSupported()) {
      // Tuned for live IPTV: decode in a worker, keep a deep-enough buffer to
      // ride out provider hiccups, and retry hard instead of dropping the
      // stream on the first failed segment.
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        maxBufferSize: 120 * 1000 * 1000,
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 12,
        highBufferWatchdogPeriod: 1,
        nudgeMaxRetry: 20,
        nudgeOffset: 0.2,
        maxFragLookUpTolerance: 0.5,
        startLevel: -1,
        abrEwmaDefaultEstimate: 3_000_000,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 60_000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4_000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 8_000 },
          },
        },
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 30_000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4_000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1_000, maxRetryDelayMs: 8_000 },
          },
        },
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Live sources drop out briefly; reload rather than give up.
          setStalled(true);
          window.setTimeout(() => hls?.startLoad(), 1_500);
          return;
        }
        setError("This channel could not be played. It may be offline or busy.");
      });
    } else {
      video.src = src;
      video.play().catch(() => {});
      video.onerror = () => setError("This channel could not be played.");
    }

    const onWaiting = () => {
      setStalled(true);
      stallTimer = window.setTimeout(() => {
        // Jump to the live edge of whatever is buffered to break a stall.
        const b = video.buffered;
        if (b.length && b.end(b.length - 1) - video.currentTime > 1) {
          video.currentTime = b.end(b.length - 1) - 0.5;
        }
        video.play().catch(() => {});
      }, 4_000);
    };
    const onPlaying = () => {
      setStalled(false);
      if (stallTimer) window.clearTimeout(stallTimer);
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    return () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, channel.kind]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium">{channel.name}</span>
          {programme && (
            <span className="block truncate text-xs text-white/60">
              {clockTime(programme.start)} – {clockTime(programme.stop)} · {programme.title}
            </span>
          )}
        </div>
        {nativeReady && !isTvDevice() && (
          <button
            type="button"
            onClick={() => void playNative()}
            className="ms-auto rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
          >
            Device player
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player"
          className={`${nativeReady && !isTvDevice() ? "" : "ms-auto"} rounded-full bg-white/10 p-2 hover:bg-white/20`}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls autoPlay playsInline className="h-full w-full bg-black" />
        {stalled && !error && (
          <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs text-white/70">
            Buffering…
          </p>
        )}
        {error && (
          <p className="absolute inset-x-4 bottom-8 text-center text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
