// Lightweight health-check for Emby / Jellyfin / Plex. Hits the public,
// no-auth identity endpoint of each server type so users can verify URL +
// reachability before committing credentials.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertSafeExternalUrl } from "./ssrf-guard";

export type HealthResult =
  | {
      ok: true;
      kind: "emby" | "jellyfin" | "plex";
      product?: string;
      version?: string;
      serverName?: string;
      latencyMs: number;
    }
  | { ok: false; error: string; latencyMs: number };

async function timedFetch(url: string, init?: RequestInit, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { res, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

export const serverHealthCheck = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["emby", "jellyfin", "plex"]),
      serverUrl: z.string().url().max(500),
    })
  )
  .handler(async ({ data }): Promise<HealthResult> => {
    const started = Date.now();
    try {
      await assertSafeExternalUrl(data.serverUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Server URL not allowed";
      return { ok: false, error: msg, latencyMs: Date.now() - started };
    }
    const base = data.serverUrl.replace(/\/+$/, "");
    try {
      if (data.kind === "plex") {
        const { res, latencyMs } = await timedFetch(`${base}/identity`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, latencyMs };
        }
        const json = (await res.json()) as {
          MediaContainer?: { friendlyName?: string; version?: string };
        };
        return {
          ok: true,
          kind: "plex",
          product: "Plex Media Server",
          version: json.MediaContainer?.version,
          serverName: json.MediaContainer?.friendlyName,
          latencyMs,
        };
      }
      // Emby / Jellyfin share the same public endpoint.
      const { res, latencyMs } = await timedFetch(`${base}/System/Info/Public`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, latencyMs };
      }
      const json = (await res.json()) as {
        ServerName?: string;
        Version?: string;
        ProductName?: string;
      };
      return {
        ok: true,
        kind: data.kind,
        product: json.ProductName ?? (data.kind === "jellyfin" ? "Jellyfin" : "Emby"),
        version: json.Version,
        serverName: json.ServerName,
        latencyMs,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return {
        ok: false,
        error: msg === "The operation was aborted." ? "Timed out after 8s" : msg,
        latencyMs: Date.now() - started,
      };
    }
  });
