import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Play } from "lucide-react";
import { toast } from "sonner";
import {
  torboxListDownloads,
  torboxPlayUrl,
  torboxStatus,
} from "@/lib/torbox.functions";

const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts)$/i;

function fmtSize(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

type Playable = {
  key: string;
  torrentId: number;
  fileId: number;
  title: string;
  file: string;
  size: number;
  state: string;
  progress: number;
};

/**
 * Homepage row of the signed-in user's TorBox cloud downloads. Renders nothing
 * until a TorBox token is connected in Settings → Integrations.
 */
export function TorboxRow({ tv = false }: { tv?: boolean }) {
  const statusFn = useServerFn(torboxStatus);
  const listFn = useServerFn(torboxListDownloads);
  const playUrlFn = useServerFn(torboxPlayUrl);

  const status = useQuery({
    queryKey: ["torbox-status"],
    queryFn: () => statusFn({}),
    staleTime: 60_000,
  });
  const connected = status.data?.connected === true;

  const downloads = useQuery({
    queryKey: ["torbox-downloads"],
    queryFn: () => listFn({}),
    enabled: connected,
  });

  if (!connected) return null;

  const list =
    downloads.data && "downloads" in downloads.data ? downloads.data.downloads : [];

  const playable: Playable[] = [];
  for (const d of list) {
    for (const f of d.files) {
      if (!(f.mimetype.startsWith("video") || VIDEO_RE.test(f.name))) continue;
      playable.push({
        key: `${d.id}:${f.id}`,
        torrentId: d.id,
        fileId: f.id,
        title: d.name,
        file: f.name,
        size: f.size || d.size,
        state: d.state,
        progress: d.progress,
      });
    }
  }

  async function onPlay(item: Playable) {
    const res = await playUrlFn({
      data: { torrentId: item.torrentId, fileId: item.fileId },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section>
      <h2
        className={
          tv
            ? "mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight"
            : "mb-4 flex items-center gap-2 text-xl font-semibold tracking-tight"
        }
      >
        <Cloud className="h-5 w-5 text-primary" />
        TorBox cloud
      </h2>

      {downloads.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your TorBox downloads…</p>
      ) : playable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No playable downloads in your TorBox cloud yet.
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
          {playable.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onPlay(item)}
              className="group flex w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-lg border bg-card/60 text-left ring-1 ring-border transition hover:ring-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex aspect-video w-full items-center justify-center bg-muted">
                <Play className="h-8 w-8 text-primary transition group-hover:scale-110" />
              </div>
              <div className="min-w-0 p-3">
                <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
                <p className="line-clamp-1 text-xs text-muted-foreground">{item.file}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtSize(item.size)}
                  {item.state ? ` · ${item.state}` : ""}
                  {item.progress < 1 ? ` · ${Math.round(item.progress * 100)}%` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
