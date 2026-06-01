import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { embyLogin } from "@/lib/emby.functions";
import { saveSession } from "@/lib/emby-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Emby" },
      { name: "description", content: "Sign in to your Emby server to stream your library." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const login = useServerFn(embyLogin);
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login({ data: { serverUrl: serverUrl.trim(), username, password } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      saveSession({
        serverUrl: serverUrl.trim().replace(/\/+$/, ""),
        token: res.token,
        userId: res.userId,
        userName: res.userName,
      });
      navigate({ to: "/library" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach server");
    } finally {
      setBusy(false);
    }
  }

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
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border bg-card/70 p-8 backdrop-blur-xl shadow-2xl">
          <div className="mb-6">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect to your Emby server and start watching.
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server">Server URL</Label>
              <Input
                id="server"
                placeholder="https://emby.example.com:8096"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                required
                autoComplete="url"
              />
            </div>
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
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
