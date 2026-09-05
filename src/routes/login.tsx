import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import relayLogo from "@/assets/relay-logo.png.asset.json";
import loginHeroes from "@/assets/login-heroes.jpg";

import { embyLogin } from "@/lib/emby.functions";
import { iptvAddM3u, iptvAddXtream } from "@/lib/iptv.functions";
import { plexAddServer } from "@/lib/plex.functions";
import { setActiveServerId, normalizeServerInput, type ServerKind } from "@/lib/media-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServerIcon, ServerLabel } from "@/components/ServerIcon";
import { SetupSyncPanel } from "@/components/SetupSyncPanel";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: typeof search.kind === "string" ? (search.kind as ServerKind) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Add server — Media" },
      {
        name: "description",
        content: "Connect an Emby, Jellyfin, Plex or IPTV (Xtream Codes / M3U) source.",
      },
    ],
  }),
  component: LoginPage,
});

const KINDS: { value: ServerKind; label: string; hint: string }[] = [
  { value: "plex", label: "Plex", hint: "192.168.1.50 or plex.example.com:32400" },
  { value: "emby", label: "Emby", hint: "192.168.1.50 or emby.example.com:8096" },
  { value: "jellyfin", label: "Jellyfin", hint: "192.168.1.50:8096 or jellyfin.example.com" },
  { value: "silo", label: "Silo", hint: "silo.example.com (coming soon)" },
  { value: "iptv", label: "IPTV", hint: "http://line.provider.tv:8080" },
];

function LoginPage() {
  const navigate = useNavigate();
  const { kind: kindParam } = Route.useSearch();
  const embyLoginFn = useServerFn(embyLogin);
  const plexAddServerFn = useServerFn(plexAddServer);
  const iptvXtreamFn = useServerFn(iptvAddXtream);
  const iptvM3uFn = useServerFn(iptvAddM3u);

  const [kind, setKind] = useState<ServerKind>(kindParam ?? "plex");
  const [iptvMode, setIptvMode] = useState<"xtream" | "m3u">("xtream");
  const [m3uUrl, setM3uUrl] = useState("");
  const [iptvName, setIptvName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [usePlexToken, setUsePlexToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const cleanUrl = normalizeServerInput(serverUrl, kind);
      // Credentials are posted to the server, which stores the resulting
      // access token in an encrypted httpOnly cookie. Nothing secret comes
      // back to this page.
      if (kind === "iptv") {
        const res =
          iptvMode === "m3u"
            ? await iptvM3uFn({ data: { url: m3uUrl.trim(), name: iptvName.trim() || undefined } })
            : await iptvXtreamFn({
                data: {
                  serverUrl: cleanUrl,
                  username: username.trim(),
                  password,
                  name: iptvName.trim() || undefined,
                },
              });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        navigate({ to: "/iptv" });
        return;
      }
      if (kind === "silo") {
        setError("Silo support is coming soon.");
        return;
      }
      if (kind === "emby" || kind === "jellyfin") {
        const res = await embyLoginFn({
          data: { kind, serverUrl: cleanUrl, username, password },
        });
        if (!res.ok) {
          setError(res.error);
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
  const isIptv = kind === "iptv";

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <img
        src={loginHeroes}
        alt=""
        aria-hidden
        width={1536}
        height={1024}
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-md"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-background/60" />
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
            <img
              src={relayLogo.url}
              alt="Relay Media logo"
              className="mx-auto mb-4 h-24 w-24 rounded-2xl object-cover shadow-lg"
            />
            <h1 className="text-3xl font-semibold tracking-tight">Add a server</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              Connect <ServerLabel kind="plex" />, <ServerLabel kind="emby" />,{" "}
              <ServerLabel kind="jellyfin" />, <ServerLabel kind="silo" /> or{" "}
              <ServerLabel kind="iptv" />. You can add more later.
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
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
            {isIptv && (
              <div className="grid grid-cols-2 gap-2">
                {(["xtream", "m3u"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setIptvMode(m);
                      setError(null);
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      iptvMode === m
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "xtream" ? "Xtream Codes" : "M3U playlist"}
                  </button>
                ))}
              </div>
            )}

            {isIptv && (
              <div className="space-y-2">
                <Label htmlFor="iptvName">Name (optional)</Label>
                <Input
                  id="iptvName"
                  value={iptvName}
                  onChange={(e) => setIptvName(e.target.value)}
                  placeholder="My IPTV"
                />
              </div>
            )}

            {isIptv && iptvMode === "m3u" && (
              <div className="space-y-2">
                <Label htmlFor="m3u">M3U playlist URL</Label>
                <Input
                  id="m3u"
                  value={m3uUrl}
                  onChange={(e) => setM3uUrl(e.target.value)}
                  placeholder="http://provider.tv/get.php?username=…&type=m3u_plus"
                  required
                  autoComplete="url"
                />
                <p className="text-xs text-muted-foreground">
                  Paste the full playlist link your provider gave you.
                </p>
              </div>
            )}

            <div className={`space-y-2 ${isIptv && iptvMode === "m3u" ? "hidden" : ""}`}>
              <Label htmlFor="server">{isIptv ? "Xtream server URL" : "Server URL"}</Label>
              <Input
                id="server"
                placeholder={KINDS.find((k) => k.value === kind)?.hint}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                required={!(isIptv && iptvMode === "m3u")}
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

            {!(isIptv && iptvMode === "m3u") && (!isPlex || !usePlexToken) && (
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
              </div>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Connecting…" : "Connect server"}
            </Button>
          </form>

          <div className="mt-8">
            <SetupSyncPanel />
          </div>
        </div>
      </div>
    </main>

  );
}
