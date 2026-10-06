import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { requestsConnect, requestsDisconnect, requestsStatus } from "@/lib/requests.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RequestsPanel() {
  const statusFn = useServerFn(requestsStatus);
  const connectFn = useServerFn(requestsConnect);
  const disconnectFn = useServerFn(requestsDisconnect);
  const status = useQuery({ queryKey: ["requests-status"], queryFn: () => statusFn() });
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const s = status.data;

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await connectFn({ data: { url, apiKey: key } });
      if (r.ok) {
        toast.success(`Requests connected — ${r.host}`);
        setKey("");
        await status.refetch();
      } else toast.error(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-lg font-semibold">Requests (Overseerr / Jellyseerr)</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Search for any film or show and ask for it to be added to your server.
      </p>
      {s?.connected ? (
        <div className="space-y-3">
          <p className="text-sm">
            Connected to <span className="font-medium">{s.host}</span>
            {s.version ? ` (v${s.version})` : ""} · key {s.keyHint}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/requests">Open Requests</Link>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await disconnectFn();
                await status.refetch();
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onConnect} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rq-url">Server address</Label>
            <Input id="rq-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="requests.example.com or example.com:5055" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-key">API key</Label>
            <Input id="rq-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} required />
            <p className="text-xs text-muted-foreground">Found in Overseerr/Jellyseerr under Settings &gt; General &gt; API Key.</p>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
        </form>
      )}
    </section>
  );
}
