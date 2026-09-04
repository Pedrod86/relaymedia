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

/**
 * Ask every connected server to start a full library scan.
 * Emby/Jellyfin have one global refresh endpoint; Plex needs a per-section
 * refresh, so we fan out across its library sections.
 */
export const refreshAllServers = createServerFn({ method: "POST" }).handler(async () => {
  const { readVault } = await import("./vault.server");
  const { normalizeUrl, embyAuthHeader, plexHeaders, plexFetch } = await import("./media.server");
  const servers = await readVault();

  const results = await Promise.all(
    servers.map(async (c) => {
      const base = { id: c.id, name: c.name, kind: c.kind };
      try {
        if (c.kind === "plex") {
          const sections = await plexFetch(c, "/library/sections");
          const dirs = (sections.MediaContainer?.Directory ?? []) as any[];
          if (!dirs.length) return { ...base, ok: false as const, error: "No libraries found." };
          await Promise.all(
            dirs.map((d) =>
              fetch(
                `${normalizeUrl(c.serverUrl)}/library/sections/${encodeURIComponent(String(d.key))}/refresh`,
                { headers: plexHeaders(c.token) },
              ).catch(() => null),
            ),
          );
          return { ...base, ok: true as const, libraries: dirs.length };
        }

        const res = await fetch(`${normalizeUrl(c.serverUrl)}/Library/Refresh`, {
          method: "POST",
          headers: {
            "X-Emby-Authorization": embyAuthHeader(c.token, c.userId),
            Authorization: embyAuthHeader(c.token, c.userId),
            "X-Emby-Token": c.token,
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(`Library refresh failed for ${c.name} [${res.status}]: ${text.slice(0, 200)}`);
          return { ...base, ok: false as const, error: `Scan failed (${res.status}).` };
        }
        return { ...base, ok: true as const };
      } catch (e: any) {
        return { ...base, ok: false as const, error: String(e?.message ?? "Could not reach server") };
      }
    }),
  );

  const started = results.filter((r) => r.ok).length;
  return {
    ok: started > 0,
    total: results.length,
    started,
    startedAt: new Date().toISOString(),
    results,
  };
});
