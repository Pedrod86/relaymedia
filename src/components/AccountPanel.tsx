import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useProAccess } from "@/lib/use-pro";
import { Button } from "@/components/ui/button";

/**
 * Relay account (separate from the media-server sign-ins). Purchases hang off
 * this account, so being able to see and leave it matters.
 */
export function AccountPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();
  const { isPro, purchasedAt } = useProAccess();

  async function onSignOut() {
    // Cancel in-flight queries before the session clears, then drop cached
    // account data so the back button can't restore a signed-in shell.
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <section className="rounded-lg border p-5">
      <h2 className="font-semibold">Relay account</h2>

      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Checking your account…</p>
      ) : !user ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            You're not signed in to a Relay account. Sign in to keep your Pro unlock and
            device list tied to you across devices.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isPro ? (
              <>
                Relay Pro — unlocked
                {purchasedAt
                  ? ` on ${new Date(purchasedAt).toLocaleDateString()}`
                  : ""}
                .
              </>
            ) : (
              <>
                Free plan.{" "}
                <Link to="/upgrade" className="underline">
                  Unlock Relay Pro
                </Link>
                .
              </>
            )}
          </p>
          <Button variant="outline" className="mt-4" onClick={onSignOut}>
            Sign out of Relay
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            This signs out of your Relay account only — your connected media servers stay
            connected on this device.
          </p>
        </>
      )}
    </section>
  );
}
