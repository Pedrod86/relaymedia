// Per-server auto-sync scheduler. Stores an interval (minutes) per server in
// localStorage and fires the appropriate refresh server function on tick.

import { useEffect } from "react";
import { listServers, type MediaServer } from "./media-client";
import { embyRefreshLibrary } from "./emby.functions";
import { plexRefreshLibrary } from "./plex.functions";

const SCHEDULE_KEY = "media_sync_schedule_v1";
const LAST_RUN_KEY = "media_sync_last_run_v1";

// 0 = off. Anything else = minutes between syncs.
export const SYNC_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every 24 hours" },
];

type ScheduleMap = Record<string, number>;
type LastRunMap = Record<string, number>;

function read<T extends object>(key: string): T {
  if (typeof window === "undefined") return {} as T;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function getSyncInterval(serverId: string): number {
  return read<ScheduleMap>(SCHEDULE_KEY)[serverId] ?? 0;
}

export function setSyncInterval(serverId: string, minutes: number) {
  if (typeof window === "undefined") return;
  const map = read<ScheduleMap>(SCHEDULE_KEY);
  if (minutes <= 0) delete map[serverId];
  else map[serverId] = minutes;
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(map));
}

export function getLastSync(serverId: string): number | null {
  return read<LastRunMap>(LAST_RUN_KEY)[serverId] ?? null;
}

function setLastSync(serverId: string, ts: number) {
  const map = read<LastRunMap>(LAST_RUN_KEY);
  map[serverId] = ts;
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(map));
}

async function runSync(server: MediaServer) {
  if (server.kind === "plex") {
    return plexRefreshLibrary({
      data: { serverUrl: server.serverUrl, token: server.token },
    });
  }
  return embyRefreshLibrary({
    data: {
      serverUrl: server.serverUrl,
      token: server.token,
      userId: server.userId,
    },
  });
}

async function tick() {
  const now = Date.now();
  const schedule = read<ScheduleMap>(SCHEDULE_KEY);
  const lastRun = read<LastRunMap>(LAST_RUN_KEY);
  const servers = listServers();
  for (const server of servers) {
    const minutes = schedule[server.id];
    if (!minutes || minutes <= 0) continue;
    const last = lastRun[server.id] ?? 0;
    if (now - last < minutes * 60_000) continue;
    setLastSync(server.id, now);
    try {
      await runSync(server);
    } catch (e) {
      // Best-effort — swallow so a single failing server doesn't stop others.
      console.warn(`Auto-sync failed for ${server.name}:`, e);
    }
  }
}

/** Mount once at app root. Checks every minute and triggers due syncs. */
export function useSyncScheduler() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Kick once on mount in case a job is overdue, then poll every minute.
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => clearInterval(id);
  }, []);
}
