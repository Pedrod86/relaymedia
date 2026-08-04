// Server-only entitlement resolution.
//
// The bearer token is attached to every server-function call by the client
// middleware in src/start.ts, but media logins are also allowed while signed
// out — so this resolves Pro access opportunistically and treats "no token" as
// "free plan" rather than an error.
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";

function isOpaqueKey(value: string) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/**
 * Build a Supabase client that acts as the calling user (RLS applies), or
 * return null when the request carries no usable bearer token.
 */
export function callerClient(): SupabaseClient<Database> | null {
  const authHeader = getRequestHeader("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  if (token.split(".").length !== 3) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;

  return createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isOpaqueKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user's id, or null when the caller is anonymous. */
export async function callerUserId(): Promise<string | null> {
  const supabase = callerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

/**
 * Which payments environment this build talks to. Derived from the build-time
 * client token prefix (Vite inlines VITE_* in the server bundle too), so a
 * sandbox test purchase can never grant entitlements on the live site.
 */
function paymentsEnvironment(): "sandbox" | "live" {
  const token = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;
  return token?.startsWith("pk_live_") ? "live" : "sandbox";
}

/** True when the caller is signed in AND has a paid Relay Pro purchase. */
export async function callerHasPro(): Promise<boolean> {
  const supabase = callerClient();
  if (!supabase) return false;

  // RLS restricts this to the token holder's own rows.
  const { data, error } = await supabase
    .from("purchases")
    .select("id")
    .eq("status", "paid")
    .eq("environment", paymentsEnvironment())
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}
