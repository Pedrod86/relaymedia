import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { embyLogin } from "@/lib/emby.functions";
import { plexAddServer } from "@/lib/plex.functions";
import { setActiveServerId, type ServerKind } from "@/lib/media-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServerIcon, ServerLabel } from "@/components/ServerIcon";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Add server — Media" },
      { name: "description", content: "Connect an Emby, Jellyfin or Plex server." },
    ],
  }),
  component: LoginPage,
});

const KINDS: { value: ServerKind; label: string; hint: string }[] = [
  { value: "emby", label: "Emby", hint: "e.g. http://192.168.1.10:8096" },
  { value: "jellyfin", label: "Jellyfin", hint: "e.g. https://jellyfin.example.com" },
  { value: "plex", label: "Plex", hint: "e.g. http://192.168.1.10:32400" },
];

function LoginPage() {
  const navigate = useNavigate();
  const embyLoginFn = useServerFn(embyLogin);
  const plexAddServerFn = useServerFn(plexAddServer);

  const [kind, setKind] = useState<ServerKind>("emby");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [usePlexToken, setUsePlexToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLimitReached(false);
    setBusy(true);
    try {
      const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
      // Credentials are posted to the server, which stores the resulting
      // access token in an encrypted httpOnly cookie. Nothing secret comes
      // back to this page.
      if (kind === "emby" || kind === "jellyfin") {
        const res = await embyLoginFn({
          data: { kind, serverUrl: cleanUrl, username, password },
        });
        if (!res.ok) {
          setError(res.error);
          setLimitReached(Boolean(res.limitReached));
          return;
        }
        setActiveServerId(res.server.id);
        navigate({ to: "/library" });
      } else {
        const res = await plexAddServerFn({
          data: usePlexToken
            ? { serverUrl: cleanUrl, token: plexToken.trim() }
            : { serverUrl: cleanUrl, username, password },
        });
        if (!res.ok) {
          setError(res.error);
          setLimitReached(Boolean(res.limitReached));
          return;
        }
        setActiveServerId(res.server.id);
        navigate({ to: "/library" });
      }
    } catch (err) {
      // Low-level network failures ("fetch failed", "Load failed") mean the
      // address is unreachable — show something a person can act on.
      const raw = err instanceof Error ? err.message : "";
      const unreachable = /fetch failed|load failed|network|timeout|ECONN|ENOTFOUND|EHOSTUNREACH/i.test(raw);
      setError(
        unreachable || !raw
          ? "Could not reach that server. Check the address, port and that it's online from this device."
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }


  const isPlex = kind === "plex";

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 20% 10%, oklch(0.4 0.15 150 / 0.35), transparent 60%), radial-gradient(ellipse at 80% 80%, oklch(0.4 0.15 270 / 0.3), transparent 60%)",
        }}
      />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border bg-card/70 p-8 backdrop-blur-xl shadow-2xl">
          <div className="mb-6">
            <h1 className="text-3xl font-semibold tracking-tight">Add a server</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              Connect <ServerLabel kind="emby" />, <ServerLabel kind="jellyfin" /> or{" "}
              <ServerLabel kind="plex" />. You can add more later.
            </p>
          </div>

          <div className="mb-5 grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => {
                  setKind(k.value);
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  kind === k.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <ServerIcon kind={k.value} size={16} />
                {k.label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server">Server URL</Label>
              <Input
                id="server"
                placeholder={KINDS.find((k) => k.value === kind)?.hint}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                required
                autoComplete="url"
              />
            </div>

            {isPlex && (
              <div className="flex items-center gap-2 text-sm">
                <input
                  id="useToken"
                  type="checkbox"
                  checked={usePlexToken}
                  onChange={(e) => setUsePlexToken(e.target.checked)}
                />
                <label htmlFor="useToken" className="text-muted-foreground">
                  I have a Plex token (skip plex.tv sign-in)
                </label>
              </div>
            )}

            {(!isPlex || !usePlexToken) && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username{isPlex ? " (plex.tv)" : ""}</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={!usePlexToken}
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required={!usePlexToken}
                  />
                </div>
              </>
            )}

            {isPlex && usePlexToken && (
              <div className="space-y-2">
                <Label htmlFor="plexToken">Plex token</Label>
                <Input
                  id="plexToken"
                  value={plexToken}
                  onChange={(e) => setPlexToken(e.target.value)}
                  placeholder="X-Plex-Token"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Get yours from{" "}
                  <a
                    className="underline"
                    href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    plex.tv docs
                  </a>
                  .
                </p>
              </div>
            )}

            {error && (
              <div className="space-y-2" role="alert">
                <p className="text-sm text-destructive">{error}</p>
                {limitReached && (
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <Link to="/upgrade">Unlock more servers with Relay Pro</Link>
                  </Button>
                )}
              </div>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Connecting…" : "Connect server"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
