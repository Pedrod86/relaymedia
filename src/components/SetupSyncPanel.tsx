import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { MonitorSmartphone, Tv } from "lucide-react";
import { createSetupCode, redeemSetupCode } from "@/lib/sync.functions";
import { applyDevicePrefs, snapshotDevicePrefs } from "@/lib/device-prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Pairing-code setup transfer. Create a code on the device that is already set
 * up (usually the phone), type it once on the TV, and every server, API key
 * and preference comes across.
 */
export function SetupSyncPanel() {
  const createFn = useServerFn(createSetupCode);
  const redeemFn = useServerFn(redeemSetupCode);

  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [entry, setEntry] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  async function onCreate() {
    setCreating(true);
    try {
      const res = await createFn({ data: { prefs: snapshotDevicePrefs() } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCode(res.code);
      setExpires(res.expiresAt);
      toast.success("Pairing code ready — enter it on your TV.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create a pairing code.");
    } finally {
      setCreating(false);
    }
  }

  async function onRedeem(e: React.FormEvent) {
    e.preventDefault();
    const clean = entry.replace(/\D/g, "");
    if (clean.length !== 6) {
      toast.error("Enter the 6-digit code shown on your phone.");
      return;
    }
    setRedeeming(true);
    try {
      const res = await redeemFn({ data: { code: clean } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      applyDevicePrefs(res.prefs);
      toast.success("Setup copied across — reloading.");
      setTimeout(() => window.location.assign("/library"), 600);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply that code.");
    } finally {
      setRedeeming(false);
    }
  }

  const expiryLabel = expires
    ? new Date(expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section className="rounded-lg border p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <MonitorSmartphone className="h-5 w-5 text-primary" />
        Sync setup to another device
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Set the app up once on your phone, then copy everything to your TV — media
        servers, TorBox and Trakt connections, theme, layout, favourites and history.
        No retyping.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="rounded-md border bg-muted/40 p-4">
          <p className="text-sm font-semibold">On this device (send)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Creates a one-time 6-digit code, valid for 10 minutes.
          </p>
          {code ? (
            <div className="mt-3">
              <p className="font-mono text-3xl font-bold tracking-[0.3em] text-primary">
                {code}
              </p>
              {expiryLabel && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Expires at {expiryLabel}. Single use.
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={onCreate}
                disabled={creating}
              >
                New code
              </Button>
            </div>
          ) : (
            <Button className="mt-3" onClick={onCreate} disabled={creating}>
              {creating ? "Creating…" : "Create pairing code"}
            </Button>
          )}
        </div>

        <div className="rounded-md border bg-muted/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Tv className="h-4 w-4 text-primary" />
            On this device (receive)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Type the code from your phone to pull its whole setup here.
          </p>
          <form onSubmit={onRedeem} className="mt-3 flex gap-2">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={entry}
              onChange={(e) => setEntry(e.target.value.replace(/\D/g, ""))}
              className="font-mono tracking-[0.25em]"
            />
            <Button type="submit" disabled={redeeming || entry.length !== 6}>
              {redeeming ? "Syncing…" : "Sync"}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
