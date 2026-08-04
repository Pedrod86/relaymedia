// Server-only entitlement resolution.
//
// The bearer token is attached to every server-function call by the client
// middleware in src/start.ts, but media logins are also allowed while signed
// out — so this resolves Pro access opportunistically and treats "no token" as
// "free plan" rather than an error.
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";

function isOpaqueKey(value: string) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** True when the caller is signed in AND has a paid Relay Pro purchase. */
export async function callerHasPro(environment: "sandbox" | "live"): Promise<boolean> {
  const authHeader = getRequestHeader("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  if (token.split(".").length !== 3) return false;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return false;

  const supabase = createClient<Database>(url, key, {
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

  // RLS restricts this to the token holder's own rows.
  const { data, error } = await supabase
    .from("purchases")
    .select("id")
    .eq("environment", environment)
    .eq("status", "paid")
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}
