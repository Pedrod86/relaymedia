import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Volume2, VolumeX, X } from "lucide-react";
import { iptvChannels, listIptvServers } from "@/lib/iptv.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/multiview")({
  head: () => ({
    meta: [
      { title: "Multi-View Live TV — Relay Media" },
      { name: "description", content: "Watch up to four live TV channels at once and switch the sound with one click." },
      { property: "og:title", content: "Multi-View Live TV — Relay Media" },
      { property: "og:description", content: "Watch up to four live TV channels at once and switch the sound with one click." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MultiViewPage,
});

type Channel = { id: string; name: string; group: string; logo: string | null; play: string; kind: "live" | "movie" };

const STREAM_PATH = "/api/public/iptv-stream";

function MultiViewPage() {
  const listFn = useServerFn(listIptvServers);
  const channelsFn = useServerFn(iptvChannels);
  const servers = useQuery({ queryKey: ["iptv-servers"], queryFn: () => listFn() });
  const [serverId, setServerId] = useState<string | null>(null);
  const sid = serverId ?? servers.data?.servers[0]?.id ?? null;
  const chans = useQuery({
    queryKey: ["iptv-channels", sid],
    enabled: !!sid,
    queryFn: () => channelsFn({ data: { serverId: sid! } }),
  });
  const live: Channel[] = chans.data?.ok ? (chans.data.channels as Channel[]).filter((c) => c.kind === "live") : [];

  const [layout, setLayout] = useState<2 | 4>(4);
  const [slots, setSlots] = useState<(Channel | null)[]>([null, null, null, null]);
  const [audio, setAudio] = useState(0);
  const [picking, setPicking] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const shown = slots.slice(0, layout);
  const filtered = live.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h1 className="mr-auto text-lg font-semibold">Multi-View</h1>
        {(servers.data?.servers.length ?? 0) > 1 && (
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={sid ?? ""}
            onChange={(e) => setServerId(e.target.value)}
          >
            {servers.data?.servers.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <Button variant={layout === 2 ? "default" : "outline"} size="sm" onClick={() => setLayout(2)}>2 screens</Button>
        <Button variant={layout === 4 ? "default" : "outline"} size="sm" onClick={() => setLayout(4)}>4 screens</Button>
        <Button variant="ghost" size="sm" asChild><Link to="/iptv">Back to Live TV</Link></Button>
      </header>

      {!servers.isLoading && !sid && (
        <p className="p-6 text-muted-foreground">Add an IPTV provider first to use Multi-View.</p>
      )}

      <div className={`grid flex-1 gap-1 p-1 ${layout === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-2"}`}>
        {shown.map((ch, i) => (
          <div key={i} className={`relative min-h-40 overflow-hidden rounded-md bg-black ${audio === i ? "ring-2 ring-primary" : ""}`}>
            {ch ? (
              <>
                <Tile channel={ch} muted={audio !== i} />
                <div className="absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/80 to-transparent p-2 text-sm text-white">
                  <span className="mr-auto truncate">{ch.name}</span>
                  <button
                    type="button"
                    data-tv-card
                    className="rounded-full bg-white/15 p-1.5 focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={audio === i ? "Sound on" : "Play sound from this screen"}
                    onClick={() => setAudio(i)}
                  >
                    {audio === i ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  </button>
                  <button type="button" className="rounded-full bg-white/15 px-2 py-1 text-xs" onClick={() => setPicking(i)}>Change</button>
                  <button
                    type="button"
                    aria-label="Remove channel"
                    className="rounded-full bg-white/15 p-1.5"
                    onClick={() => setSlots((s) => s.map((x, j) => (j === i ? null : x)))}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                data-tv-card
                onClick={() => setPicking(i)}
                className="tv-card flex h-full w-full items-center justify-center text-sm text-white/70 outline-none focus-visible:ring-4 focus-visible:ring-ring"
              >
                + Add channel
              </button>
            )}
          </div>
        ))}
      </div>

      {picking !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur">
          <div className="flex max-h-[80dvh] w-full max-w-md flex-col gap-3 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Pick a channel</h2>
              <Button size="icon" variant="ghost" onClick={() => setPicking(null)} aria-label="Close"><X className="size-4" /></Button>
            </div>
            <input
              autoFocus
              className="rounded-md border bg-background px-3 py-2"
              placeholder="Filter channels"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="flex-1 overflow-y-auto">
              {chans.isLoading && <p className="text-sm text-muted-foreground">Loading channels…</p>}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    setSlots((s) => s.map((x, j) => (j === picking ? c : x)));
                    setPicking(null);
                  }}
                >
                  {c.logo && <img src={c.logo} alt="" className="size-6 object-contain" />}
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{c.group}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Tile({ channel, muted }: { channel: Channel; muted: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const src = `${STREAM_PATH}?t=${encodeURIComponent(channel.play)}`;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      // Lighter buffers than the single-channel player so four streams fit.
      hls = new Hls({ enableWorker: true, maxBufferLength: 15, backBufferLength: 10, capLevelToPlayerSize: true });
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else window.setTimeout(() => hls?.startLoad(), 1500);
      });
    } else {
      v.src = src;
      v.play().catch(() => {});
    }
    return () => hls?.destroy();
  }, [src]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  return <video ref={ref} muted={muted} playsInline className="absolute inset-0 h-full w-full object-contain" />;
}
