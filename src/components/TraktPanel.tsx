import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  traktDisconnect,
  traktPollPairing,
  traktRecentHistory,
  traktStartPairing,
  traktStatus,
} from "@/lib/trakt.functions";
import { Button } from "@/components/ui/button";

type Pairing = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
};

/**
 * Trakt pairing via the OAuth device flow: the app shows a short code, the user
 * approves it on trakt.tv from any device. No keyboard-hostile redirect, which
 * matters on Android TV.
 */
export function TraktPanel() {
  const statusFn = useServerFn(traktStatus);
  const startFn = useServerFn(traktStartPairing);
  const pollFn = useServerFn(traktPollPairing);
  const disconnectFn = useServerFn(traktDisconnect);
  const historyFn = useServerFn(traktRecentHistory);

  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = useQuery({ queryKey: ["trakt-status"], queryFn: () => statusFn({}) });
  const account = status.data?.connected === true ? status.data : null;
  const configured = status.data?.configured !== false;

  const history = useQuery({
    queryKey: ["trakt-history"],
    queryFn: () => historyFn({}),
    enabled: Boolean(account),
  });

  // Poll Trakt while a pairing code is on screen.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || !pairing) return;
      if (Date.now() > pairing.expiresAt) {
        setPairing(null);
        toast.error("That Trakt code expired — try again.");
        return;
      }
      let wait = pairing.interval * 1000;
      try {
        const res = await pollFn({ data: { deviceCode: pairing.deviceCode } });
        if (cancelled) return;
        if (res.state === "authorized") {
          setPairing(null);
          toast.success(`Trakt connected — ${res.status.username}`);
          await status.refetch();
          await history.refetch();
          return;
        }
        if (res.state === "denied") {
          setPairing(null);
          toast.error("Trakt access was declined.");
          return;
        }
        if (res.state === "expired") {
          setPairing(null);
          toast.error("That Trakt code expired — try again.");
          return;
        }
        if (res.state === "error") {
          setPairing(null);
          toast.error(res.error ?? "Trakt pairing failed.");
          return;
        }
        if (res.state === "slow_down") wait += 2000;
      } catch {
        wait += 2000;
      }
      timer.current = setTimeout(tick, wait);
    }

    timer.current = setTimeout(tick, pairing.interval * 1000);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await startFn({});
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPairing({
        deviceCode: res.deviceCode,
        userCode: res.userCode,
        verificationUrl: res.verificationUrl,
        interval: Math.max(2, res.interval),
        expiresAt: Date.now() + res.expiresIn * 1000,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reach Trakt");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!confirm("Disconnect Trakt? Playback will stop being scrobbled.")) return;
    setBusy(true);
    try {
      await disconnectFn({});
      toast.success("Trakt disconnected.");
      await status.refetch();
    } finally {
      setBusy(false);
    }
  }

  const historyItems =
    history.data && "items" in history.data ? history.data.items : [];

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Trakt</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect Trakt to scrobble what you watch — progress, pauses and finished
        episodes sync automatically while you play from any connected server.
      </p>

      {!configured ? (
        <p className="mt-4 text-sm text-destructive">
          Trakt isn't configured for this app yet.
        </p>
      ) : status.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Checking Trakt…</p>
      ) : account ? (
        <>
          <div className="mt-4 rounded-md border bg-muted/40 p-4">
            <p className="text-sm">
              Connected as <span className="font-medium">{account.username}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paired {new Date(account.connectedAt).toLocaleDateString()} · tokens are
              stored encrypted on the server.
            </p>
          </div>

          {historyItems.length > 0 && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Recently scrobbled
              </p>
              <ul className="mt-2 divide-y text-sm">
                {historyItems.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      {h.title}
                      {h.subtitle ? (
                        <span className="text-muted-foreground"> · {h.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {h.watchedAt ? new Date(h.watchedAt).toLocaleDateString() : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="outline" size="sm" className="mt-4" onClick={onDisconnect} disabled={busy}>
            Disconnect Trakt
          </Button>
        </>
      ) : pairing ? (
        <div className="mt-4 rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            On any device, open{" "}
            <a
              href={pairing.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline"
            >
              {pairing.verificationUrl.replace(/^https?:\/\//, "")}
            </a>{" "}
            and enter this code:
          </p>
          <p className="mt-3 text-center font-mono text-3xl font-semibold tracking-[0.35em]">
            {pairing.userCode}
          </p>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Waiting for approval… this page finishes on its own.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => setPairing(null)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button className="mt-4" onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Connect Trakt"}
        </Button>
      )}
    </section>
  );
}
