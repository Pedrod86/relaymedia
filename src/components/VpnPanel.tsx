import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { isNativeApp } from "@/lib/platform";

type VpnStatus = { available: boolean; connected: boolean; hasConfig: boolean; appOnly: boolean; error?: string };
type VpnPlugin = {
  getStatus: () => Promise<VpnStatus>;
  saveConfig: (o: { config: string; appOnly: boolean }) => Promise<VpnStatus>;
  clearConfig: () => Promise<VpnStatus>;
  connect: () => Promise<VpnStatus>;
  disconnect: () => Promise<VpnStatus>;
};

function plugin(): VpnPlugin | null {
  if (typeof window === "undefined" || !isNativeApp()) return null;
  const w = window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } };
  return (w.Capacitor?.Plugins?.["RelayVpn"] as VpnPlugin | undefined) ?? null;
}

export function VpnPanel() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState("");
  const [appOnly, setAppOnly] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = plugin();
    if (!p) return setReady(true);
    p.getStatus()
      .then((s) => {
        setStatus(s);
        setAppOnly(s.appOnly);
      })
      .catch(() => setStatus(null))
      .finally(() => setReady(true));
  }, []);

  async function run(fn: (p: VpnPlugin) => Promise<VpnStatus>, ok?: string) {
    const p = plugin();
    if (!p) return;
    setBusy(true);
    try {
      setStatus(await fn(p));
      if (ok) toast.success(ok);
    } catch (e: any) {
      toast.error(e?.message ?? "VPN action failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (f) setConfig(await f.text());
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">VPN (WireGuard)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Send Relay Media through your own WireGuard VPN. Get a WireGuard config file from
        your VPN provider (Mullvad, Proton, Surfshark, NordVPN and others offer one) and paste it here.
      </p>

      {!ready ? null : (
        <div className="mt-4 space-y-4">
          {status ? (
            <p className="text-sm">
              Status:{" "}
              <span className={status.connected ? "font-medium text-primary" : "text-muted-foreground"}>
                {status.connected ? "Connected" : status.hasConfig ? "Disconnected" : "Not set up"}
              </span>
            </p>
          ) : (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              You're in the web app right now. The VPN connects inside the <strong>Relay Media Android app
              (version 1.7 or newer)</strong> on phones and TV boxes — but you can paste your config below, and
              it will be ready to save on your device.
            </p>
          )}

          {status?.hasConfig && (
            <div className="flex flex-wrap gap-2">
              {status.connected ? (
                <Button disabled={busy} onClick={() => run((p) => p.disconnect(), "VPN disconnected")}>
                  Disconnect
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => run((p) => p.connect(), "VPN connected")}>
                  {busy ? "Connecting…" : "Connect"}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => confirm("Remove the saved VPN config?") && run((p) => p.clearConfig(), "VPN removed")}
              >
                Remove config
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="vpn-config" className="text-sm font-medium">
              Your WireGuard config
            </label>
            <textarea
              id="vpn-config"
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              placeholder={"[Interface]\nPrivateKey = …\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0"}
              rows={8}
              spellCheck={false}
              className="w-full min-h-24 rounded-md border bg-card p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-accent">
                Choose a .conf file…
                <input
                  type="file"
                  accept=".conf,.conf.txt,text/plain"
                  onChange={(e) => onFile(e.target.files?.[0])}
                  className="sr-only"
                />
              </label>
              {config.trim() && (
                <Button variant="ghost" size="sm" onClick={() => setConfig("")}>
                  Clear
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={appOnly} onCheckedChange={(c) => setAppOnly(!!c)} />
              Only use the VPN for Relay Media (other apps stay on your normal connection)
            </label>
            <Button
              variant="secondary"
              disabled={busy || !config.trim()}
              onClick={() => {
                if (!status) {
                  toast.error("The VPN connects inside the Android app (1.7+). Paste the config there on your phone or TV box.");
                  return;
                }
                run((p) => p.saveConfig({ config, appOnly }), "VPN config saved").then(() => setConfig(""));
              }}
            >
              {status?.hasConfig ? "Replace config" : "Save config"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Your config is stored only inside the app on this device and never sent to our servers.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
