// Favourites and "watch later" — stored per media server in localStorage.
//
// Like watch history, this holds no credentials: only a small snapshot of each
// item (id, title, artwork tags) so saved rows render instantly.

const KEY_PREFIX = "media:saved:";
const MAX_ENTRIES = 200;

export type SavedList = "favourite" | "later";

export type SavedEntry = {
  id: string;
  name: string;
  type?: string;
  seriesName?: string;
  year?: number;
  savedAt: number;
  /** Enough artwork metadata for MediaImage / imageUrl to build URLs. */
  item: Record<string, unknown>;
};

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
  "UserData",
] as const;

function snapshot(item: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of IMAGE_FIELDS) if (item?.[f] !== undefined) out[f] = item[f];
  return out;
}

function keyFor(serverId: string, list: SavedList) {
  return `${KEY_PREFIX}${list}:${serverId}`;
}

export function loadSaved(serverId: string, list: SavedList): SavedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyFor(serverId, list));
    const parsed = raw ? (JSON.parse(raw) as SavedEntry[]) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.id) : [];
  } catch {
    return [];
  }
}

function save(serverId: string, list: SavedList, entries: SavedEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      keyFor(serverId, list),
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    /* storage full / disabled — saving is a nicety, never fatal */
  }
  notify();
}

export function isSaved(serverId: string, list: SavedList, id: string) {
  return loadSaved(serverId, list).some((e) => e.id === String(id));
}

export function addSaved(serverId: string, list: SavedList, item: any) {
  if (!item?.Id) return;
  const id = String(item.Id);
  const entry: SavedEntry = {
    id,
    name: String(item.Name ?? "Unknown"),
    type: item.Type ? String(item.Type) : undefined,
    seriesName: item.SeriesName ? String(item.SeriesName) : undefined,
    year: Number(item.ProductionYear) || undefined,
    savedAt: Date.now(),
    item: snapshot(item),
  };
  save(serverId, list, [entry, ...loadSaved(serverId, list).filter((e) => e.id !== id)]);
}

export function removeSaved(serverId: string, list: SavedList, id: string) {
  save(
    serverId,
    list,
    loadSaved(serverId, list).filter((e) => e.id !== String(id)),
  );
}

/** Add or remove; returns the new saved state. */
export function toggleSaved(serverId: string, list: SavedList, item: any): boolean {
  const id = String(item?.Id ?? "");
  if (!id) return false;
  if (isSaved(serverId, list, id)) {
    removeSaved(serverId, list, id);
    return false;
  }
  addSaved(serverId, list, item);
  return true;
}

export function clearSaved(serverId: string, list: SavedList) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyFor(serverId, list));
  notify();
}

/** Turn a saved entry back into an item shape the cards understand. */
export function savedToItem(e: SavedEntry) {
  return {
    Id: e.id,
    Name: e.name,
    Type: e.type,
    SeriesName: e.seriesName,
    ProductionYear: e.year,
    ...e.item,
  } as any;
}

// ── Change notification ────────────────────────────────────────────────────

const EVENT = "media:saved-changed";

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function onSavedChange(fn: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
