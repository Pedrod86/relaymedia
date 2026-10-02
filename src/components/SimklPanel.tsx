import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  simklDisconnect,
  simklPollPairing,
  simklStartPairing,
  simklStatus,
} from "@/lib/simkl.functions";
import { Button } from "@/components/ui/button";

type Pairing = { userCode: string; verificationUrl: string; interval: number; expiresAt: number };

export function SimklPanel() {
  const statusFn = useServerFn(simklStatus);
  const startFn = useServerFn(simklStartPairing);
  const pollFn = useServerFn(simklPollPairing);
  const disconnectFn = useServerFn(simklDisconnect);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ["simkl-status"], queryFn: () => statusFn({}) });
  const account = status.data?.connected === true ? status.data : null;
  const configured = status.data?.configured !== false;

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > pairing.expiresAt) {
        setPairing(null);
        toast.error("That Simkl code expired — try again.");
        return;
      }
      try {
        const res = await pollFn({ data: { userCode: pairing.userCode } });
        if (cancelled) return;
        if (res.state === "authorized") {
          setPairing(null);
          toast.success(`Simkl connected — ${res.username}`);
          await status.refetch();
          return;
        }
        if (res.state === "error") {
          setPairing(null);
          toast.error(res.error ?? "Simkl pairing failed.");
          return;
        }
      } catch {
        /* retry */
      }
      t = setTimeout(tick, pairing.interval * 1000);
    };
    t = setTimeout(tick, pairing.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await startFn({});
      if (!res.ok) return void toast.error(res.error);
      setPairing({
        userCode: res.userCode,
        verificationUrl: res.verificationUrl,
        interval: Math.max(3, res.interval),
        expiresAt: Date.now() + res.expiresIn * 1000,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reach Simkl");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!confirm("Disconnect Simkl?")) return;
    setBusy(true);
    try {
      await disconnectFn({});
      toast.success("Simkl disconnected.");
      await status.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Simkl</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect Simkl to track what you watch — movies and episodes sync automatically while you play.
      </p>
      {!configured ? (
        <p className="mt-4 text-sm text-destructive">Simkl API key hasn't been added yet.</p>
      ) : status.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Checking Simkl…</p>
      ) : account ? (
        <>
          <div className="mt-4 rounded-md border bg-muted/40 p-4 text-sm">
            Connected as <span className="font-medium">{account.username}</span>
          </div>
          <Button variant="outline" size="sm" className="mt-4" onClick={onDisconnect} disabled={busy}>
            Disconnect Simkl
          </Button>
        </>
      ) : pairing ? (
        <div className="mt-4 rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            On any device, open{" "}
            <a href={pairing.verificationUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
              {pairing.verificationUrl.replace(/^https?:\/\//, "")}
            </a>{" "}
            and enter this code:
          </p>
          <p className="mt-3 text-center font-mono text-3xl font-semibold tracking-[0.35em]">{pairing.userCode}</p>
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setPairing(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button className="mt-4" onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Connect Simkl"}
        </Button>
      )}
    </section>
  );
}
