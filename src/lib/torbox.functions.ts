// Server functions for connecting a TorBox account and browsing its cloud
// downloads. The API token never leaves the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type TorboxStatus =
  | { connected: false }
  | {
      connected: true;
      email: string;
      plan: string;
      tokenHint: string;
      connectedAt: string;
    };

const PLAN_NAMES: Record<number, string> = {
  0: "Free",
  1: "Essential",
  2: "Pro",
  3: "Standard",
};

function planName(plan: unknown) {
  const n = typeof plan === "number" ? plan : Number(plan);
  return PLAN_NAMES[n] ?? (Number.isFinite(n) ? `Plan ${n}` : "Unknown");
}

export const torboxStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<TorboxStatus> => {
    const { readTorbox, toPublicTorbox } = await import("./torbox.server");
    const cred = await readTorbox();
    return cred ? toPublicTorbox(cred) : { connected: false };
  },
);

export const torboxConnect = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().trim().min(10).max(400) }))
  .handler(async ({ data }) => {
    const { torboxGet, writeTorbox } = await import("./torbox.server");
    try {
      const me = await torboxGet<{ email?: string; plan?: number }>(
        data.token,
        "/user/me",
        { settings: "false" },
      );
      const cred = {
        token: data.token,
        email: me?.email ?? "TorBox account",
        plan: planName(me?.plan),
        connectedAt: new Date().toISOString(),
      };
      await writeTorbox(cred);
      const { toPublicTorbox } = await import("./torbox.server");
      return { ok: true as const, status: toPublicTorbox(cred) };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "TORBOX_BAD_TOKEN")
        return {
          ok: false as const,
          error: "That API token was rejected by TorBox. Check it and try again.",
        };
      return { ok: false as const, error: msg };
    }
  });

export const torboxDisconnect = createServerFn({ method: "POST" }).handler(async () => {
  const { writeTorbox } = await import("./torbox.server");
  await writeTorbox(null);
  return { ok: true as const };
});

export type TorboxFile = {
  id: number;
  name: string;
  size: number;
  mimetype: string;
};

export type TorboxDownload = {
  id: number;
  name: string;
  size: number;
  progress: number;
  state: string;
  cached: boolean;
  createdAt: string | null;
  files: TorboxFile[];
};

/** The user's TorBox cloud torrent list, normalised for the UI. */
export const torboxListDownloads = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ downloads: TorboxDownload[] } | { error: string }> => {
    const { requireTorbox, torboxGet } = await import("./torbox.server");
    try {
      const cred = await requireTorbox();
      const list = await torboxGet<any[]>(cred.token, "/torrents/mylist", {
        bypass_cache: "true",
      });
      const downloads = (Array.isArray(list) ? list : []).map((t) => ({
        id: Number(t.id),
        name: String(t.name ?? "Untitled"),
        size: Number(t.size ?? 0),
        progress: Number(t.progress ?? 0),
        state: String(t.download_state ?? (t.download_finished ? "completed" : "queued")),
        cached: Boolean(t.cached ?? t.download_present),
        createdAt: t.created_at ? String(t.created_at) : null,
        files: (Array.isArray(t.files) ? t.files : []).map((f: any) => ({
          id: Number(f.id),
          name: String(f.short_name ?? f.name ?? "file"),
          size: Number(f.size ?? 0),
          mimetype: String(f.mimetype ?? ""),
        })),
      }));
      return { downloads };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "TORBOX_NOT_CONNECTED") return { error: "TorBox is not connected." };
      if (msg === "TORBOX_BAD_TOKEN")
        return { error: "TorBox rejected the saved token — reconnect your account." };
      return { error: msg };
    }
  },
);

/** Resolve a short-lived, direct playback URL for one file in a download. */
export const torboxPlayUrl = createServerFn({ method: "POST" })
  .inputValidator(z.object({ torrentId: z.number().int(), fileId: z.number().int() }))
  .handler(async ({ data }) => {
    const { requireTorbox, torboxGet } = await import("./torbox.server");
    try {
      const cred = await requireTorbox();
      const url = await torboxGet<string>(cred.token, "/torrents/requestdl", {
        token: cred.token,
        torrent_id: String(data.torrentId),
        file_id: String(data.fileId),
        redirect: "false",
      });
      if (!url) return { ok: false as const, error: "TorBox returned no download link." };
      return { ok: true as const, url: String(url) };
    } catch (e: any) {
      return { ok: false as const, error: String(e?.message ?? e) };
    }
  });
