// Pairing-code setup transfer: phone creates a code, TV redeems it.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const prefsSchema = z.record(z.string().max(120), z.string().max(200_000));

export const createSetupCode = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prefs: prefsSchema }))
  .handler(async ({ data }) => {
    const { createTransfer } = await import("./sync.server");
    try {
      const res = await createTransfer(data.prefs);
      return { ok: true as const, ...res };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "NOTHING_TO_SYNC")
        return {
          ok: false as const,
          error: "Sign into a media server on this device first, then create a code.",
        };
      return { ok: false as const, error: msg };
    }
  });

export const redeemSetupCode = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().trim().regex(/^\d{6}$/) }))
  .handler(async ({ data }) => {
    const { redeemTransfer } = await import("./sync.server");
    try {
      const prefs = await redeemTransfer(data.code);
      return { ok: true as const, prefs };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "BAD_CODE")
        return { ok: false as const, error: "That code isn't valid. Check it and retry." };
      if (msg === "CODE_EXPIRED")
        return {
          ok: false as const,
          error: "That code has expired — make a new one on your phone.",
        };
      return { ok: false as const, error: msg };
    }
  });
