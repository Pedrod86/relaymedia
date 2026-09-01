import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { useProAccess } from "@/lib/use-pro";
import { PRO_PRICE_ID, PRO_PRICE_LABEL, isPaymentsConfigured } from "@/lib/stripe";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { FREE_ACCESS } from "@/lib/free-access";

const PERKS = [
  "4K Dolby Vision & HDR10 passthrough",
  "TV mode — 10-foot remote-friendly interface",
  "Hardware vs software decoder control",
  "Unlimited connected Emby, Jellyfin & Plex servers",
  "Quality caps, tone-mapping and advanced player tuning",
];

export const Route = createFileRoute("/upgrade")({
  head: () => ({
    meta: [
      { title: "Relay Pro — unlock 4K HDR & TV mode" },
      {
        name: "description",
        content:
          "Unlock Relay Pro for a one-time $1: 4K Dolby Vision playback, HDR10, TV mode, decoder control and unlimited server connections.",
      },
      { property: "og:title", content: "Relay Pro — unlock 4K HDR & TV mode" },
      {
        property: "og:description",
        content:
          "One-time $1 unlock: 4K Dolby Vision, HDR10, TV mode and unlimited server connections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UpgradePage,
});

function UpgradePage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { isPro, isLoading: proLoading } = useProAccess();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const configured = isPaymentsConfigured() && !FREE_ACCESS;

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth", replace: true });
  }, [authLoading, user, navigate]);

  return (
    <main className="min-h-screen bg-background">
      {!FREE_ACCESS && <PaymentTestModeBanner />}

      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Relay</p>
            <h1 className="text-lg font-semibold">Relay Pro</h1>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/library">Back</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {proLoading ? (
          <p className="text-muted-foreground">Checking your account…</p>
        ) : isPro ? (
          <section className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold">
              {FREE_ACCESS ? "Everything's unlocked — free 🎉" : "You're on Relay Pro 🎉"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {FREE_ACCESS
                ? "Relay Pro is free for everyone right now — 4K Dolby Vision, HDR10, TV mode, decoder control and unlimited servers, at no cost. No payment needed."
                : "Every Pro feature is unlocked on this account. Thanks for supporting Relay."}
            </p>
            {FREE_ACCESS && (
              <ul className="mt-5 space-y-3">
                {PERKS.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button className="mt-5" asChild>
              <Link to="/library">Start watching</Link>
            </Button>
          </section>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <section>
              <h2 className="text-2xl font-semibold">Unlock everything, once</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                One payment of{" "}
                <span className="font-medium text-foreground">{PRO_PRICE_LABEL}</span>. No
                subscription, no renewal. Relay keeps connecting to your own media servers
                — Pro unlocks the advanced playback and interface features.
              </p>
              <ul className="mt-6 space-y-3">
                {PERKS.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border p-6">
              {!configured ? (
                <p className="text-sm text-destructive">
                  Checkout isn't configured for this build yet.
                </p>
              ) : checkoutOpen ? (
                <StripeEmbeddedCheckout
                  priceId={PRO_PRICE_ID}
                  returnUrl={`${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`}
                />
              ) : (
                <>
                  <p className="text-3xl font-semibold">$1</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    one-time payment · lifetime unlock
                  </p>
                  <Button className="mt-6 w-full" onClick={() => setCheckoutOpen(true)}>
                    Unlock Relay Pro
                  </Button>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Secure checkout. Taxes calculated at payment.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
