// Simkl pairing (PIN flow, TV-friendly) and scrobbling. Tokens stay server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SimklStatus =
  | { connected: false; configured: boolean }
  | { connected: true; configured: true; username: string; connectedAt: string };

export const simklStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SimklStatus> => {
    const { readSimkl, simklClientId } = await import("./simkl.server");
    try {
      simklClientId();
    } catch {
      return { connected: false, configured: false };
    }
    const c = await readSimkl();
    return c
      ? { connected: true, configured: true, username: c.username, connectedAt: c.connectedAt }
      : { connected: false, configured: true };
  },
);

export const simklStartPairing = createServerFn({ method: "POST" }).handler(async () => {
  const { requestPin } = await import("./simkl.server");
  try {
    const p = await requestPin();
    return {
      ok: true as const,
      userCode: p.user_code,
      verificationUrl: p.verification_url || "https://simkl.com/pin",
      expiresIn: p.expires_in || 900,
      interval: p.interval || 5,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg === "SIMKL_NOT_CONFIGURED")
      return { ok: false as const, error: "Add your Simkl API key first." };
    return { ok: false as const, error: msg };
  }
});

export const simklPollPairing = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userCode: z.string().min(3).max(50) }))
  .handler(async ({ data }) => {
    const { pollPin, writeSimkl } = await import("./simkl.server");
    try {
      const cred = await pollPin(data.userCode);
      if (!cred) return { state: "pending" as const };
      await writeSimkl(cred);
      return { state: "authorized" as const, username: cred.username };
    } catch (e: any) {
      return { state: "error" as const, error: String(e?.message ?? e) };
    }
  });

export const simklDisconnect = createServerFn({ method: "POST" }).handler(async () => {
  const { writeSimkl } = await import("./simkl.server");
  await writeSimkl(null);
  return { ok: true as const };
});

const ids = z
  .object({
    imdb: z.string().max(30).optional(),
    tmdb: z.number().int().optional(),
    tvdb: z.number().int().optional(),
  })
  .partial();

export const simklScrobble = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      action: z.enum(["start", "pause", "stop"]),
      progress: z.number().min(0).max(100),
      type: z.enum(["movie", "episode"]),
      title: z.string().max(300).optional(),
      year: z.number().int().optional(),
      ids: ids.optional(),
      season: z.number().int().optional(),
      number: z.number().int().optional(),
      showTitle: z.string().max(300).optional(),
      showIds: ids.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { simklRequest } = await import("./simkl.server");
    const body: Record<string, unknown> = { progress: data.progress };
    if (data.type === "movie") {
      body["movie"] = { title: data.title, year: data.year, ids: data.ids ?? {} };
    } else {
      body["episode"] = { season: data.season, number: data.number, ids: data.ids ?? {} };
      body["show"] = { title: data.showTitle, ids: data.showIds ?? {} };
    }
    try {
      await simklRequest(`/scrobble/${data.action}`, { method: "POST", body: JSON.stringify(body) });
      return { ok: true as const };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "SIMKL_NOT_CONNECTED" || msg === "SIMKL_NOT_CONFIGURED")
        return { ok: false as const, error: "not_connected" };
      return { ok: false as const, error: msg };
    }
  });
