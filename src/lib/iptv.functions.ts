// Server functions for IPTV providers (Xtream Codes + M3U playlists).
// Credentials never reach the browser; playback URLs are sealed tokens.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const urlish = z.string().trim().min(4).max(2048);

export const iptvAddXtream = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      serverUrl: urlish,
      username: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(200),
      name: z.string().trim().max(80).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { assertSafeServerUrl, normalizeUrl } = await import("./media.server");
    const { xtreamAuth } = await import("./iptv.server");
    const { addCredential } = await import("./vault.server");
    try {
      const base = normalizeUrl(data.serverUrl);
      assertSafeServerUrl(base);
      const info = await xtreamAuth(base, data.username, data.password);
      const server = await addCredential({
        kind: "iptv",
        mode: "xtream",
        name: data.name?.trim() || new URL(base).hostname,
        serverUrl: base,
        token: data.password,
        userId: data.username,
        userName: info.userName,
      });
      return { ok: true as const, server, expires: info.expires };
    } catch (e: any) {
      return { ok: false as const, error: friendly(e) };
    }
  });

export const iptvAddM3u = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: urlish, name: z.string().trim().max(80).optional() }))
  .handler(async ({ data }) => {
    const { assertSafeServerUrl } = await import("./media.server");
    const { m3uProbe } = await import("./iptv.server");
    const { addCredential } = await import("./vault.server");
    try {
      assertSafeServerUrl(data.url);
      const count = await m3uProbe(data.url);
      const server = await addCredential({
        kind: "iptv",
        mode: "m3u",
        name: data.name?.trim() || new URL(data.url).hostname,
        serverUrl: data.url,
        token: "",
        userId: "",
        userName: "M3U playlist",
      });
      return { ok: true as const, server, channels: count };
    } catch (e: any) {
      return { ok: false as const, error: friendly(e) };
    }
  });

/** IPTV providers currently connected (metadata only). */
export const listIptvServers = createServerFn({ method: "GET" }).handler(async () => {
  const { readVault, toPublic } = await import("./vault.server");
  return {
    servers: (await readVault()).filter((c) => c.kind === "iptv").map(toPublic),
  };
});

export const removeIptvServer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ serverId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { removeCredential } = await import("./vault.server");
    await removeCredential(data.serverId);
    return { ok: true as const };
  });

/** Channels/groups for one provider. Sealed playback tokens are included. */
export const iptvChannels = createServerFn({ method: "POST" })
  .inputValidator(z.object({ serverId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { requireCredential } = await import("./vault.server");
    const { loadChannels } = await import("./iptv.server");
    try {
      const cred = await requireCredential(data.serverId);
      if (cred.kind !== "iptv") return { ok: false as const, error: "Not an IPTV provider." };
      const channels = await loadChannels(cred);
      const groups = [...new Set(channels.map((c) => c.group))].sort((a, b) =>
        a.localeCompare(b),
      );
      return { ok: true as const, channels, groups };
    } catch (e: any) {
      return { ok: false as const, error: friendly(e) };
    }
  });

function friendly(e: any): string {
  const raw = String(e?.message ?? e ?? "");
  if (raw === "SERVER_SESSION_EXPIRED") return "That provider is no longer connected. Add it again.";
  if (/fetch failed|load failed|network|timeout|ECONN|ENOTFOUND|EHOSTUNREACH/i.test(raw)) {
    return "Could not reach that provider. Check the address and that it is online.";
  }
  return raw || "Something went wrong connecting to that provider.";
}
