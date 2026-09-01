// Personal watch history — stored per media server in localStorage.
//
// It holds no credentials: just a small snapshot of each item (id, title,
// artwork tags, genres) so history rows and suggestions render instantly
// without another round-trip to the server.

const KEY_PREFIX = "media:history:";
const MAX_ENTRIES = 60;

export type HistoryEntry = {
  /** Item id on the media server. */
  id: string;
  name: string;
  type?: string;
  seriesName?: string;
  seriesId?: string;
  year?: number;
  genres: string[];
  /** 0-100 */
  progress: number;
  /** true once watched past ~90% */
  completed: boolean;
  watchedAt: number;
  /** Enough artwork metadata for MediaImage / imageUrl to build URLs. */
  item: Record<string, unknown>;
};

function keyFor(serverId: string) {
  return KEY_PREFIX + serverId;
}

export function loadHistory(serverId: string): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyFor(serverId));
    const list = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && e.id) : [];
  } catch {
    return [];
  }
}

function save(serverId: string, list: HistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(serverId), JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full / disabled — history is a nicety, never fatal */
  }
}

export function clearHistory(serverId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyFor(serverId));
  notify();
}

export function removeHistoryEntry(serverId: string, id: string) {
  save(
    serverId,
    loadHistory(serverId).filter((e) => e.id !== id),
  );
  notify();
}

/** Artwork-relevant fields we keep so cards render from the snapshot alone. */
const IMAGE_FIELDS = [
  "Id",
  "Name",
  "Type",
  "ProductionYear",
  "ImageTags",
  "BackdropImageTags",
  "ParentBackdropImageTags",
  "ParentBackdropItemId",
  "ParentThumbImageTag",
  "ParentThumbItemId",
  "SeriesPrimaryImageTag",
  "SeriesId",
  "SeriesName",
  "IndexNumber",
  "ParentIndexNumber",
] as const;

function snapshot(item: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of IMAGE_FIELDS) if (item?.[f] !== undefined) out[f] = item[f];
  return out;
}

/**
 * Record (or update) a viewing. Repeat plays of the same item update the same
 * entry and move it to the front, so history reads as "most recent first".
 */
export function recordWatch(
  serverId: string,
  item: any,
  progress: number,
): HistoryEntry[] {
  if (!item?.Id) return loadHistory(serverId);
  const list = loadHistory(serverId);
  const id = String(item.Id);
  const prev = list.find((e) => e.id === id);
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const entry: HistoryEntry = {
    id,
    name: String(item.Name ?? prev?.name ?? "Unknown"),
    type: item.Type ? String(item.Type) : prev?.type,
    seriesName: item.SeriesName ? String(item.SeriesName) : prev?.seriesName,
    seriesId: item.SeriesId ? String(item.SeriesId) : prev?.seriesId,
    year: Number(item.ProductionYear) || prev?.year,
    genres: Array.isArray(item.Genres)
      ? item.Genres.map((g: unknown) => String(g))
      : (prev?.genres ?? []),
    progress: Math.max(pct, prev && !prev.completed ? 0 : 0) || pct,
    completed: pct >= 90 || Boolean(prev?.completed && pct < 5),
    watchedAt: Date.now(),
    item: { ...(prev?.item ?? {}), ...snapshot(item) },
  };
  const next = [entry, ...list.filter((e) => e.id !== id)];
  save(serverId, next);
  notify();
  return next;
}

/** Titles finished at least once. */
export function watchedEntries(list: HistoryEntry[]) {
  return list.filter((e) => e.completed);
}

/**
 * Favourite genres, most-watched first. Completed titles count double so
 * suggestions lean towards what was actually enjoyed, not just sampled.
 */
export function topGenres(list: HistoryEntry[], limit = 4): string[] {
  const score = new Map<string, number>();
  for (const e of list) {
    const weight = e.completed ? 2 : 1;
    for (const g of e.genres) score.set(g, (score.get(g) ?? 0) + weight);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}

// ── Change notification ────────────────────────────────────────────────────
// Lets any mounted view refresh when history changes in this tab.

const EVENT = "media:history-changed";

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function onHistoryChange(fn: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
