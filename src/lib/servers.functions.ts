// Server functions for managing the connected-server list. Credentials stay
// in the encrypted httpOnly cookie; only non-sensitive metadata is returned.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listMediaServers = createServerFn({ method: "GET" }).handler(async () => {
  const { readVault, toPublic } = await import("./vault.server");
  return { servers: (await readVault()).map(toPublic) };
});

export const removeMediaServer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ serverId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { removeCredential } = await import("./vault.server");
    return { servers: await removeCredential(data.serverId) };
  });

export const signOutAllServers = createServerFn({ method: "POST" }).handler(async () => {
  const { clearCredentials } = await import("./vault.server");
  await clearCredentials();
  return { ok: true as const };
});
