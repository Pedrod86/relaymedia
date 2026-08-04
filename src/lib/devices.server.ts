// Account-based device registry.
//
// Each browser/TV gets an opaque device key in an httpOnly cookie. When a
// signed-in user connects a media server, that device is registered against
// their account so the number of devices per account can be capped by plan.
import { getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { callerClient } from "./entitlements.server";
import { deviceLimitFor } from "./limits";

const DEVICE_COOKIE = "mv_device";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 730;

/** Read (or mint) this device's opaque key. */
export function deviceKey(): string {
  const existing = getCookie(DEVICE_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  setCookie(DEVICE_COOKIE, key, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return key;
}

/** A short human label so the device list is recognisable in Settings. */
function deviceLabel(): string {
  const ua = getRequestHeader("user-agent") ?? "";
  if (/AFT|GoogleTV|BRAVIA|SmartTV|Tizen|Web0S|CrKey/i.test(ua)) return "TV";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/iPhone|Android|Mobile/i.test(ua)) return "Phone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return "Device";
}

export type DeviceCheck =
  | { allowed: true }
  | { allowed: false; limit: number };

/**
 * Register this device for the signed-in caller, enforcing the plan's device
 * cap. Anonymous callers are not tracked (nothing to attach a device to), so
 * they are always allowed through — the per-device server cap still applies.
 */
export async function registerDevice(isPro: boolean): Promise<DeviceCheck> {
  const supabase = callerClient();
  if (!supabase) return { allowed: true };
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return { allowed: true };

  const key = deviceKey();
  const { data: devices, error } = await supabase
    .from("devices")
    .select("id, device_key")
    .eq("user_id", userId);
  if (error) return { allowed: true }; // never block playback on a registry read failure

  const mine = devices?.find((d) => d.device_key === key);
  if (mine) {
    await supabase
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", mine.id);
    return { allowed: true };
  }

  const limit = deviceLimitFor(isPro);
  if ((devices?.length ?? 0) >= limit) return { allowed: false, limit };

  await supabase
    .from("devices")
    .insert({ user_id: userId, device_key: key, label: deviceLabel() });
  return { allowed: true };
}

/** Devices on the caller's account, newest activity first. */
export async function listDevicesForCaller() {
  const supabase = callerClient();
  if (!supabase) return { devices: [], currentDeviceKey: null as string | null };
  const { data, error } = await supabase
    .from("devices")
    .select("id, label, last_seen_at, created_at, device_key")
    .order("last_seen_at", { ascending: false });
  if (error) return { devices: [], currentDeviceKey: null as string | null };
  const current = getCookie(DEVICE_COOKIE) ?? null;
  return {
    devices: (data ?? []).map((d) => ({
      id: d.id,
      label: d.label,
      lastSeenAt: d.last_seen_at,
      createdAt: d.created_at,
      isCurrent: d.device_key === current,
    })),
    currentDeviceKey: current,
  };
}

/** Remove a device from the caller's account (RLS keeps this owner-scoped). */
export async function revokeDeviceForCaller(deviceId: string): Promise<boolean> {
  const supabase = callerClient();
  if (!supabase) return false;
  const { error } = await supabase.from("devices").delete().eq("id", deviceId);
  return !error;
}
