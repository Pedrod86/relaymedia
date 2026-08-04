import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Duplicated locally (structurally identical to the server StripeEnv) so this
// browser module has no import into server-only code.
export type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

// Derive the environment from the token PREFIX, never from its mere presence.
// A missing/unknown token is a configuration error — do NOT fall through to
// 'live', which would surface as a cryptic server error deep in checkout.
function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Payments are not configured for this build. Complete Stripe go-live in your Lovable project to enable production checkout.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

export function isPaymentsConfigured(): boolean {
  return Boolean(
    clientToken?.startsWith("pk_test_") || clientToken?.startsWith("pk_live_"),
  );
}

export const PRO_PRICE_ID = "pro_unlock_lifetime";
export const PRO_PRICE_LABEL = "$15 one-time";
