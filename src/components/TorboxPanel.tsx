import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  torboxConnect,
  torboxDisconnect,
  torboxListDownloads,
  torboxPlayUrl,
  torboxStatus,
} from "@/lib/torbox.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts)$/i;

export function TorboxPanel() {
  const statusFn = useServerFn(torboxStatus);
  const connectFn = useServerFn(torboxConnect);
  const disconnectFn = useServerFn(torboxDisconnect);
  const listFn = useServerFn(torboxListDownloads);
  const playUrlFn = useServerFn(torboxPlayUrl);

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ["torbox-status"], queryFn: () => statusFn({}) });
  const account = status.data?.connected === true ? status.data : null;
  const connected = account !== null;

  const downloads = useQuery({
    queryKey: ["torbox-downloads"],
    queryFn: () => listFn({}),
    enabled: connected,
  });

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    try {
      const res = await connectFn({ data: { token: token.trim() } });
      if (res.ok) {
        setToken("");
        toast.success(`TorBox connected — ${res.status.email}`);
        await status.refetch();
        await downloads.refetch();
      } else {
        toast.error(res.error);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Could not reach TorBox");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!confirm("Disconnect TorBox? The saved API token will be deleted.")) return;
    await disconnectFn({});
    toast.success("TorBox disconnected.");
    status.refetch();
  }

  async function onPlay(torrentId: number, fileId: number) {
    const res = await playUrlFn({ data: { torrentId, fileId } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  const list =
    downloads.data && "downloads" in downloads.data ? downloads.data.downloads : [];
  const listError = downloads.data && "error" in downloads.data ? downloads.data.error : null;

  return (
    <section className="rounded-lg border p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">TorBox</h2>
        {connected && (
          <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">
            Connected
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your TorBox account to stream your cloud downloads alongside your media
        servers.
      </p>

      {!connected ? (
        <form onSubmit={onConnect} className="mt-4 space-y-3">
          <div>
            <label htmlFor="torbox-token" className="text-sm font-medium">
              TorBox API token
            </label>
            <Input
              id="torbox-token"
              type="password"
              autoComplete="off"
              placeholder="Paste your TorBox API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Find it in TorBox under Settings → API. It is stored encrypted on the
              server and never exposed to your browser.
            </p>
          </div>
          <Button type="submit" disabled={busy || !token.trim()}>
            {busy ? "Connecting…" : "Connect TorBox"}
          </Button>
        </form>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{account!.email}</p>
              <p className="text-xs text-muted-foreground">
                {account!.plan} plan · token {account!.tokenHint}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloads.refetch()}
                disabled={downloads.isFetching}
              >
                {downloads.isFetching ? "Syncing…" : "Sync"}
              </Button>
              <Button size="sm" variant="ghost" onClick={onDisconnect}>
                Disconnect
              </Button>
            </div>
          </div>

          {listError ? (
            <p className="text-sm text-destructive">{listError}</p>
          ) : downloads.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your cloud downloads…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No downloads in your TorBox cloud yet.
            </p>
          ) : (
            <ul className="divide-y">
              {list.map((d) => {
                const videos = d.files.filter((f) =>
                  f.mimetype.startsWith("video") || VIDEO_RE.test(f.name),
                );
                return (
                  <li key={d.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtSize(d.size)} · {d.state}
                          {d.progress < 1 ? ` · ${Math.round(d.progress * 100)}%` : ""}
                          {d.cached ? " · cached" : ""}
                        </p>
                      </div>
                    </div>
                    {videos.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {videos.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-accent"
                          >
                            <span className="min-w-0 truncate text-xs">
                              {f.name}{" "}
                              <span className="text-muted-foreground">
                                ({fmtSize(f.size)})
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onPlay(d.id, f.id)}
                            >
                              Play
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
