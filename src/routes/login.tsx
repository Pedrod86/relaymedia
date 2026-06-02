import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { embyApiKeyLogin, embyLogin } from "@/lib/emby.functions";
import { plexVerify } from "@/lib/plex.functions";
import { serverHealthCheck, type HealthResult } from "@/lib/health.functions";
import { addServer, type ServerKind } from "@/lib/media-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const embyApiKeyLoginFn = useServerFn(embyApiKeyLogin);
  const plexVerifyFn = useServerFn(plexVerify);
  const healthFn = useServerFn(serverHealthCheck);

  const [kind, setKind] = useState<ServerKind>("emby");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useEmbyApiKey, setUseEmbyApiKey] = useState(false);
  const [embyApiKey, setEmbyApiKey] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [checking, setChecking] = useState(false);

  async function onCheck() {
    setError(null);
    setHealth(null);
    const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!cleanUrl) {
      setError("Enter a server URL first.");
      return;
    }
    setChecking(true);
    try {
      const res = await healthFn({ data: { kind, serverUrl: cleanUrl } });
      setHealth(res);
    } catch (e) {
      setHealth({
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
        latencyMs: 0,
      });
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
      if (kind === "emby" || kind === "jellyfin") {
        const res = useEmbyApiKey
          ? await embyApiKeyLoginFn({ data: { serverUrl: cleanUrl, apiKey: embyApiKey, username: username.trim() || undefined } })
          : await embyLoginFn({ data: { serverUrl: cleanUrl, username, password } });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        addServer({
          kind,
          name: new URL(cleanUrl).host,
          serverUrl: cleanUrl,
          token: res.token,
          userId: res.userId,
          userName: res.userName,
        });
        navigate({ to: "/library" });
      } else {
        // Plex
        const token = plexToken.trim();
        const userName = "Plex user";
        if (!token) {
          setError("Plex token is required.");
          return;
        }
        if (!/^[A-Za-z0-9_-]{10,}$/.test(token)) {
          setError("That Plex token does not look valid. Paste only the X-Plex-Token value, not the full URL or article text.");
          return;
        }
        const verify = await plexVerifyFn({ data: { serverUrl: cleanUrl, token } });
        if (!verify.ok) {
          setError(verify.error);
          return;
        }
        addServer({
          kind: "plex",
          name: verify.friendlyName,
          serverUrl: cleanUrl,
          token,
          userId: verify.machineId,
          userName,
        });
        navigate({ to: "/library" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach server");
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
            <p className="mt-1 text-sm text-muted-foreground">
              Connect Emby, Jellyfin or Plex. You can add more later.
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
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  kind === k.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
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
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={checking}
                  onClick={onCheck}
                >
                  {checking ? "Checking…" : "Test connection"}
                </Button>
                {health && health.ok && (
                  <span className="text-xs text-emerald-500">
                    ✓ {health.product ?? health.kind}
                    {health.version ? ` ${health.version}` : ""}
                    {health.serverName ? ` · ${health.serverName}` : ""}
                    {` · ${health.latencyMs}ms`}
                  </span>
                )}
                {health && !health.ok && (
                  <span className="text-xs text-destructive">
                    ✗ {health.error}
                  </span>
                )}
              </div>
            </div>

            {!isPlex && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
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
                    required
                  />
                </div>
              </>
            )}

            {isPlex && (
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
                  Plex password sign-in is currently blocked by Plex rate limits, so token login is required.
                </p>
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

            {error && <LoginErrorAlert message={error} />}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Connecting…" : "Connect server"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

function LoginErrorAlert({ message }: { message: string }) {
  const lower = message.toLowerCase();
  const isProxy1003 =
    lower.includes("1003") ||
    lower.includes("cloudflare") ||
    lower.includes("proxy") ||
    lower.includes("remote access");
  const isDeviceDenied = lower.includes("device access");
  const isMaxSessions = lower.includes("maximum") && lower.includes("session");

  if (!isProxy1003 && !isDeviceDenied && !isMaxSessions) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {message}
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-destructive font-semibold">!</span>
        <div className="space-y-1">
          <p className="font-medium text-destructive">
            {isProxy1003
              ? "Emby/Jellyfin is rejecting the live app connection (403/1003)"
              : isDeviceDenied
                ? "This device is not allowed to sign in"
                : "Your server has hit its session limit"}
          </p>
          <p className="text-muted-foreground">{message}</p>
        </div>
      </div>

      {isProxy1003 && (
        <div className="space-y-2 pl-6">
          <p className="font-medium text-foreground">How to fix it:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>
              In Emby/Jellyfin server settings, enable <strong>remote connections</strong>.
            </li>
            <li>
              In that user’s settings, allow <strong>remote access</strong> for the account you are signing in with.
            </li>
            <li>
              Use the real public media-server URL, ideally <code className="text-foreground">https://emby.yourdomain.com</code>, not an admin/proxy-only URL.
            </li>
            <li>
              If you use Cloudflare, Nginx Proxy Manager, Authelia, or a firewall, allow server-to-server requests with <code>User-Agent: RelayMedia/1.0</code>.
            </li>
            <li>
              Confirm <code className="text-foreground">/System/Info/Public</code> and <code className="text-foreground">/Users/AuthenticateByName</code> are reachable from outside your home network.
            </li>
          </ol>
        </div>
      )}

      {isDeviceDenied && (
        <div className="space-y-2 pl-6">
          <p className="font-medium text-foreground">How to fix it:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Open your media server admin dashboard.</li>
            <li>
              Go to <strong>Devices</strong> and approve / unblock this device,
              or disable "Require approval for new devices".
            </li>
            <li>Try signing in again.</li>
          </ol>
        </div>
      )}

      {isMaxSessions && (
        <div className="space-y-2 pl-6">
          <p className="font-medium text-foreground">How to fix it:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Stop one of your active streams on another device.</li>
            <li>
              Or raise the user's session limit in{" "}
              <strong>Dashboard → Users → [user] → Max sessions</strong>.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
