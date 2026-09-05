import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { Loader2, Radio, Search, Trash2, Tv, X } from "lucide-react";

import { iptvChannels, listIptvServers, removeIptvServer } from "@/lib/iptv.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerIcon } from "@/components/ServerIcon";

export const Route = createFileRoute("/iptv")({
  head: () => ({
    meta: [
      { title: "Live TV — Relay Media" },
      {
        name: "description",
        content: "Watch your IPTV channels and playlists — Xtream Codes or M3U — inside Relay Media.",
      },
      { property: "og:title", content: "Live TV — Relay Media" },
      {
        property: "og:description",
        content: "Watch your IPTV channels and playlists — Xtream Codes or M3U — inside Relay Media.",
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
};

const STREAM_PATH = "/api/public/iptv-stream";

function IptvPage() {
  const listFn = useServerFn(listIptvServers);
  const channelsFn = useServerFn(iptvChannels);
  const removeFn = useServerFn(removeIptvServer);
  const queryClient = useQueryClient();

  const [serverId, setServerId] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<Channel | null>(null);

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

                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {visible.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setPlaying(c)}
                        className="flex w-full flex-col items-center gap-2 rounded-xl border bg-card/60 p-3 text-center transition hover:border-primary focus:border-primary focus:outline-none"
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
                        <span className="line-clamp-2 text-xs font-medium">{c.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {visible.length === 0 && (
                  <p className="text-sm text-muted-foreground">No channels match that search.</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {playing && <ChannelPlayer channel={playing} onClose={() => setPlaying(null)} />}
    </main>
  );
}

function ChannelPlayer({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const src = `${STREAM_PATH}?t=${encodeURIComponent(channel.play)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    let hls: Hls | null = null;
    const isHls = channel.kind === "live" || /\.m3u8/i.test(src);

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, backBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else setError("This channel could not be played. It may be offline or busy.");
      });
    } else {
      video.src = src;
      video.play().catch(() => {});
      video.onerror = () => setError("This channel could not be played.");
    }

    return () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, channel.kind]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="truncate text-sm font-medium">{channel.name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player"
          className="ms-auto rounded-full bg-white/10 p-2 hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls autoPlay playsInline className="h-full w-full bg-black" />
        {error && (
          <p className="absolute inset-x-4 bottom-8 text-center text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
