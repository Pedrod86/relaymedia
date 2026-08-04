import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, createStripeClient, verifyWebhook } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";

// Deferred so env availability is not assumed at module load time.
let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    );
  }
  return _supabase;
}

async function recordPurchase(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("Checkout session has no userId metadata; cannot record purchase");
    return;
  }

  // Webhook payloads do NOT include line_items, so resolve the human-readable
  // price id from Stripe directly. lookup_key is stable across sandbox/live.
  let priceId: string = session.metadata?.priceId ?? "pro_unlock_lifetime";
  try {
    const items = await createStripeClient(env).checkout.sessions.listLineItems(session.id, {
      limit: 1,
    });
    const key = items.data[0]?.price?.lookup_key;
    if (key) priceId = key;
  } catch (e) {
    console.error("Could not resolve line items for session", session.id, e);
  }

  const { error } = await getSupabase()
    .from("purchases")
    .upsert(
      {
        user_id: userId,
        price_id: priceId,
        stripe_customer_id:
          typeof session.customer === "string" ? session.customer : session.customer?.id,
        stripe_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        environment: env,
        status: "paid",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_session_id" },
    );

  if (error) console.error("Failed to record purchase:", error.message);
}

async function markFailed(session: any, env: StripeEnv) {
  const { error } = await getSupabase()
    .from("purchases")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("stripe_session_id", session.id)
    .eq("environment", env);
  if (error) console.error("Failed to mark purchase failed:", error.message);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // Delayed-notification methods (SEPA, boleto, OXXO) stay "unpaid" here and
      // settle days later via async_payment_succeeded. "no_payment_required"
      // (100% promo, zero total) is final and never fires an async event.
      if (session.payment_status !== "unpaid") {
        await recordPurchase(session, env);
      }
      break;
    }
    case "checkout.session.async_payment_succeeded":
      await recordPurchase(event.data.object, env);
      break;
    case "checkout.session.async_payment_failed":
      await markFailed(event.data.object, env);
      break;
    case "charge.refunded":
      // Refunds are handled manually and never revoke access, so this is
      // recorded for visibility only.
      console.log("Charge refunded (access retained):", event.data.object.id);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received with invalid or missing env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
