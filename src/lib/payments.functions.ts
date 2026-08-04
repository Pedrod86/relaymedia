import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

type CheckoutSessionResult = { clientSecret: string } | { error: string };

// Resolve (or create) a Stripe Customer carrying metadata.userId. Session
// metadata is NOT searchable, so the userId has to live on the Customer for any
// later read path (dashboards, refunds, support lookups) to resolve it.
async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length && found.data[0]) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    const customer = existing.data[0];
    if (customer) {
      if (options.userId && customer.metadata?.["userId"] !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

export const createProCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    // Identity comes from the validated bearer token, never from request data.
    const { supabase, userId } = context;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    try {
      const stripe = createStripeClient(data.environment);

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      const stripePrice = prices.data[0];
      if (!stripePrice) throw new Error("Price not found");

      const customerId = await resolveOrCreateCustomer(stripe, {
        email: user?.email ?? undefined,
        userId,
      });

      const productId =
        typeof stripePrice.product === "string"
          ? stripePrice.product
          : stripePrice.product.id;
      const product = await stripe.products.retrieve(productId);

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        // Lands on the Charge description so the payments dashboard shows the
        // product name instead of "Unknown product".
        payment_intent_data: { description: product.name },
        // Stripe handles tax compliance, fraud, disputes and transaction
        // support for buyers in supported countries.
        managed_payments: { enabled: true },
        metadata: {
          userId,
          managed_payments: "true",
        },
      } as any);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      // Surface the real Stripe message — the global request middleware would
      // otherwise replace it with a generic 500.
      return { error: getStripeErrorMessage(error) };
    }
  });

export type ProStatus = { isPro: boolean; purchasedAt: string | null };

export const getProStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<ProStatus> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("purchases")
      .select("created_at")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Failed to read purchases:", error.message);
      return { isPro: false, purchasedAt: null };
    }

    const row = rows?.[0];
    return { isPro: Boolean(row), purchasedAt: row?.created_at ?? null };
  });

/**
 * Fulfillment fallback for the return page.
 *
 * Webhooks are the primary path, but a delayed or dropped delivery would leave
 * a paying customer without Pro. This re-reads the Checkout Session straight
 * from Stripe and records the purchase itself when it is settled, so the unlock
 * never depends on a single webhook arriving.
 */
export const verifyProPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    return data;
  })
  .handler(async ({ data, context }): Promise<ProStatus> => {
    const { userId } = context;
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId, {
        expand: ["line_items"],
      });

      // The session must belong to the caller — never trust the id alone.
      if (session.metadata?.["userId"] !== userId) {
        return { isPro: false, purchasedAt: null };
      }
      // "unpaid" means a delayed-notification method hasn't settled yet.
      if (session.payment_status === "unpaid") {
        return { isPro: false, purchasedAt: null };
      }

      const priceId =
        session.line_items?.data?.[0]?.price?.lookup_key ?? "pro_unlock_lifetime";

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("purchases").upsert(
        {
          user_id: userId,
          price_id: priceId,
          stripe_customer_id:
            typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
          stripe_session_id: session.id,
          stripe_payment_intent_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? null),
          amount_total: session.amount_total ?? null,
          currency: session.currency ?? null,
          environment: data.environment,
          status: "paid",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_session_id" },
      );
      if (error) {
        console.error("Failed to reconcile purchase:", error.message);
        return { isPro: false, purchasedAt: null };
      }

      return { isPro: true, purchasedAt: new Date().toISOString() };
    } catch (error) {
      console.error("verifyProPurchase failed:", getStripeErrorMessage(error));
      return { isPro: false, purchasedAt: null };
    }
  });
