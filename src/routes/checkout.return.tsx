import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyProPurchase } from "@/lib/payments.functions";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/lib/use-auth";
import { useProAccess } from "@/lib/use-pro";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout/return")({
  // session_id comes from Stripe's substitution of {CHECKOUT_SESSION_ID}.
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payment complete — Relay Pro" },
      {
        name: "description",
        content: "Your Relay Pro unlock is confirmed. Head back to your library and start watching.",
      },
      { property: "og:title", content: "Payment complete — Relay Pro" },
      {
        property: "og:description",
        content: "Your Relay Pro unlock is confirmed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id: sessionId } = Route.useSearch();
  const { isPro, refresh } = useProAccess();
  const { user } = useAuth();
  const verify = useServerFn(verifyProPurchase);

  // Two paths converge here. The webhook usually writes the purchase row within
  // seconds, so poll for it — but also ask the server to read the session back
  // from Stripe, so a delayed or dropped webhook can't leave a paying customer
  // without their unlock.
  useEffect(() => {
    if (!sessionId || isPro || !user || !isPaymentsConfigured()) return;
    let cancelled = false;

    void (async () => {
      const result = await verify({
        data: { sessionId, environment: getStripeEnvironment() },
      });
      if (!cancelled && result.isPro) refresh();
    })();

    const timer = setInterval(refresh, 2000);
    const stop = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [sessionId, isPro, user, verify, refresh]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border p-8 text-center">
        {!sessionId ? (
          <>
            <h1 className="text-xl font-semibold">No payment information found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              If you completed a payment, it may still be processing.
            </p>
          </>
        ) : isPro ? (
          <>
            <h1 className="text-xl font-semibold">Relay Pro unlocked 🎉</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Thanks for the support. 4K HDR playback, TV mode and decoder controls are now
              available on your account.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Payment received</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We're confirming it with your bank. This page updates automatically — it
              usually takes a few seconds.
            </p>
          </>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link to="/library">Go to library</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/upgrade">Pro status</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
