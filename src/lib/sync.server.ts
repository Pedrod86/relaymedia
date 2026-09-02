// Server-only "hand my setup to the TV" transfer.
//
// The phone bundles everything needed to run the app — media-server
// credentials, TorBox/Trakt tokens, and the device's UI preferences — encrypts
// it with MEDIA_VAULT_SECRET and stores it against a short-lived 6-digit
// pairing code. The TV redeems the code once; the row is deleted immediately
// and the credentials land straight in the TV's httpOnly cookies, so no token
// is ever exposed to browser JavaScript on either device.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { COOKIE_NAME as VAULT_COOKIE } from "./vault.server";
import { TORBOX_COOKIE } from "./torbox.server";
import { TRAKT_COOKIE } from "./trakt.server";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Cookies carried across. Each value is already encrypted at rest. */
const SYNCED_COOKIES = [VAULT_COOKIE, TORBOX_COOKIE, TRAKT_COOKIE] as const;

export type SyncBundle = {
  /** Encrypted cookie values, keyed by cookie name. */
  cookies: Record<string, string>;
  /** Non-sensitive UI preferences copied verbatim from localStorage. */
  prefs: Record<string, string>;
  createdAt: string;
};

function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: "/",
    maxAge,
  };
}

/** Collect this device's setup and park it behind a fresh pairing code. */
export async function createTransfer(prefs: Record<string, string>) {
  const { sealJson } = await import("./vault.server");

  const cookies: Record<string, string> = {};
  for (const name of SYNCED_COOKIES) {
    const raw = getCookie(name);
    if (raw) cookies[name] = raw;
  }
  if (Object.keys(cookies).length === 0) {
    throw new Error("NOTHING_TO_SYNC");
  }

  const bundle: SyncBundle = { cookies, prefs, createdAt: new Date().toISOString() };
  const payload = await sealJson(bundle);
  const db = await admin();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  // Clear anything already expired so codes stay short and reusable.
  await db.from("setup_transfers").delete().lt("expires_at", new Date().toISOString());

  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const { error } = await db
      .from("setup_transfers")
      .insert({ code, payload, expires_at: expiresAt });
    if (!error) return { code, expiresAt, servers: Object.keys(cookies).length };
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not allocate a pairing code — please try again.");
}

/** Redeem a pairing code: install the cookies here and return the prefs. */
export async function redeemTransfer(code: string): Promise<Record<string, string>> {
  const { openJson } = await import("./vault.server");
  const db = await admin();

  const { data: row, error } = await db
    .from("setup_transfers")
    .select("id, payload, attempts, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("BAD_CODE");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.from("setup_transfers").delete().eq("id", row.id);
    throw new Error("CODE_EXPIRED");
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.from("setup_transfers").delete().eq("id", row.id);
    throw new Error("CODE_EXPIRED");
  }

  const bundle = await openJson<SyncBundle>(row.payload);
  if (!bundle) {
    await db.from("setup_transfers").delete().eq("id", row.id);
    throw new Error("BAD_CODE");
  }

  for (const [name, value] of Object.entries(bundle.cookies)) {
    if (!SYNCED_COOKIES.includes(name as (typeof SYNCED_COOKIES)[number])) continue;
    setCookie(name, value, cookieOptions(COOKIE_MAX_AGE));
  }

  // One-shot: the code cannot be replayed on a third device.
  await db.from("setup_transfers").delete().eq("id", row.id);
  return bundle.prefs ?? {};
}
