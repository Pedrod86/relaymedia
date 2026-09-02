import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Relay account" },
      {
        name: "description",
        content:
          "Sign in or create a Relay account to sync your servers and devices.",
      },
      { property: "og:title", content: "Sign in — Relay account" },
      {
        property: "og:description",
        content: "Sign in or create a Relay account to sync your servers and devices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentConfirmation, setSentConfirmation] = useState(false);

  useEffect(() => {
    if (!isLoading && user) navigate({ to: "/library", replace: true });
  }, [isLoading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/library` },
        });
        if (error) throw error;
        // With email confirmation on, signUp returns no session — the user is
        // NOT signed in until they click the link.
        if (!data.session) {
          setSentConfirmation(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Google sign-in failed. Please try again.");
        return;
      }
      if (result.redirected) return;
    } catch {
      toast.error("Google sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onApple() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Apple sign-in failed. Please try again.");
        return;
      }
      if (result.redirected) return;
    } catch {
      toast.error("Apple sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentConfirmation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-lg border p-6 text-center">
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <span className="font-medium">{email}</span>.
            Click it to finish creating your account.
          </p>
          <Button variant="ghost" className="mt-4" onClick={() => setSentConfirmation(false)}>
            Back
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Relay</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A Relay account keeps your servers and devices in sync, on every device.
          </p>
        </div>

        <div className="rounded-lg border p-6">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onGoogle}
            disabled={busy}
          >
            Continue with Google
          </Button>

          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={onApple}
            disabled={busy}
          >
            <svg viewBox="0 0 384 512" aria-hidden="true" className="mr-2 h-4 w-4 fill-current">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-36.8-2.8-77 21.3-91.7 21.3-15.5 0-51.2-20.3-79.2-20.3C56.5 141.2 0 189.3 0 285.2c0 28.3 5.2 57.5 15.5 87.6 13.8 39.6 46.3 109.2 80.2 108.2 17.7-.4 30.2-12.6 53.3-12.6 22.4 0 34 12.2 53.7 12.2 34.2-.5 63.6-63.8 76.7-103.5-45.8-21.6-60.7-62.4-60.7-108.4zM255.3 84.6c17.5-21.2 26.8-46.2 26.8-71.9 0-3.5-.3-7.1-.8-10.7-25.4 1.2-53.6 15.4-70.3 35.8-15.4 18.6-27.5 43.4-27.5 68.5 0 3.9.6 7.8 1 9 1.5.3 3.9.6 6.3.6 22.7 0 51.3-13.2 64.5-31.3z" />
            </svg>
            Continue with Apple
          </Button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-sm text-muted-foreground underline"
          >
            {mode === "signin"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/library" className="underline">
            Skip — just use my media servers
          </Link>
        </p>
      </div>
    </main>
  );
}
