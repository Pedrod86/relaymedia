import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  traktDeviceCode,
  traktDevicePoll,
  traktGetUser,
  traktRevoke,
} from "@/lib/trakt.functions";
import {
  clearTraktSession,
  loadTraktSession,
  saveTraktSession,
  sessionFromToken,
  type TraktSession,
} from "@/lib/trakt-client";

export function TraktPanel() {
  const [session, setSession] = useState<TraktSession | null>(null);
  const [pending, setPending] = useState<{
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getCode = useServerFn(traktDeviceCode);
  const pollCode = useServerFn(traktDevicePoll);
  const getUser = useServerFn(traktGetUser);
  const revoke = useServerFn(traktRevoke);

  useEffect(() => {
    setSession(loadTraktSession());
    const onChange = () => setSession(loadTraktSession());
    window.addEventListener("trakt:session", onChange);
    return () => window.removeEventListener("trakt:session", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function onConnect() {
    setBusy(true);
    try {
      const res = await getCode({});
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const expiresAt = Date.now() + res.expires_in * 1000;
      setPending({
        userCode: res.user_code,
        verificationUrl: res.verification_url,
        expiresAt,
      });
      const intervalMs = Math.max(res.interval, 5) * 1000;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (Date.now() > expiresAt) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPending(null);
          toast.error("Trakt code expired. Try again.");
          return;
        }
        const poll = await pollCode({ data: { deviceCode: res.device_code } });
        if (poll.ok) {
          if (pollRef.current) clearInterval(pollRef.current);
          const partial = sessionFromToken(poll);
          const me = await getUser({ data: { accessToken: poll.access_token } });
          const full = sessionFromToken(poll, {
            username: me.user.username,
            name: me.user.name,
            avatar: me.user.images?.avatar?.full,
          });
          saveTraktSession(full);
          setPending(null);
          toast.success(`Connected as ${me.user.username}`);
          // silence unused
          void partial;
        } else if (poll.status === "expired" || poll.status === "denied") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPending(null);
          toast.error(`Trakt sign-in ${poll.status}.`);
        }
      }, intervalMs);
    } catch (e: any) {
      toast.error(e?.message ?? "Trakt connect failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    const s = loadTraktSession();
    if (!s) return;
    if (!confirm("Disconnect Trakt on this device?")) return;
    try {
      await revoke({ data: { accessToken: s.accessToken } });
    } catch {
      /* ignore */
    }
    clearTraktSession();
    toast.success("Trakt disconnected.");
  }

  function onCancel() {
    if (pollRef.current) clearInterval(pollRef.current);
    setPending(null);
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Trakt</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sync watch history, ratings, collection and watchlist with your{" "}
        <a
          className="underline"
          href="https://trakt.tv"
          target="_blank"
          rel="noreferrer"
        >
          trakt.tv
        </a>{" "}
        account.
      </p>

      {session ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {session.user?.avatar && (
              <img
                src={session.user.avatar}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            )}
            <div>
              <p className="font-medium">{session.user?.name ?? session.user?.username}</p>
              <p className="text-xs text-muted-foreground">@{session.user?.username}</p>
            </div>
          </div>
          <Button variant="outline" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      ) : pending ? (
        <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-4">
          <p className="text-sm">
            1. Open{" "}
            <a
              className="underline"
              href={pending.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              {pending.verificationUrl}
            </a>
          </p>
          <p className="text-sm">2. Enter this code:</p>
          <p className="font-mono text-3xl tracking-[0.4em] text-foreground">
            {pending.userCode}
          </p>
          <p className="text-xs text-muted-foreground">
            Waiting for you to authorize… this dialog will close automatically.
          </p>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <Button onClick={onConnect} disabled={busy}>
            {busy ? "Starting…" : "Connect Trakt"}
          </Button>
        </div>
      )}
    </section>
  );
}
