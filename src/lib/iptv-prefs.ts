// Per-provider Live TV preferences (favourites, recently watched, category
// order and hidden categories). Stored on the device under a "relay:" key so
// they also travel with the phone → TV setup handoff.
import { useCallback, useEffect, useState } from "react";

export type IptvPrefs = {
  favs: string[];
  recent: string[];
  order: string[];
  hidden: string[];
};

const EMPTY: IptvPrefs = { favs: [], recent: [], order: [], hidden: [] };
const RECENT_MAX = 12;
const key = (serverId: string) => `relay:iptv-prefs:${serverId}`;

function read(serverId: string): IptvPrefs {
  try {
    const raw = localStorage.getItem(key(serverId));
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    return {
      favs: Array.isArray(p.favs) ? p.favs : [],
      recent: Array.isArray(p.recent) ? p.recent : [],
      order: Array.isArray(p.order) ? p.order : [],
      hidden: Array.isArray(p.hidden) ? p.hidden : [],
    };
  } catch {
    return EMPTY;
  }
}

export function useIptvPrefs(serverId: string | null) {
  const [prefs, setPrefs] = useState<IptvPrefs>(EMPTY);

  useEffect(() => {
    setPrefs(serverId ? read(serverId) : EMPTY);
  }, [serverId]);

  const update = useCallback(
    (fn: (p: IptvPrefs) => IptvPrefs) => {
      if (!serverId) return;
      setPrefs((prev) => {
        const next = fn(prev);
        try {
          localStorage.setItem(key(serverId), JSON.stringify(next));
        } catch {
          /* storage full — keep in memory */
        }
        return next;
      });
    },
    [serverId],
  );

  return {
    prefs,
    toggleFav: (id: string) =>
      update((p) => ({
        ...p,
        favs: p.favs.includes(id) ? p.favs.filter((f) => f !== id) : [id, ...p.favs],
      })),
    markWatched: (id: string) =>
      update((p) => ({ ...p, recent: [id, ...p.recent.filter((r) => r !== id)].slice(0, RECENT_MAX) })),
    clearRecent: () => update((p) => ({ ...p, recent: [] })),
    toggleHidden: (group: string) =>
      update((p) => ({
        ...p,
        hidden: p.hidden.includes(group) ? p.hidden.filter((g) => g !== group) : [...p.hidden, group],
      })),
    setOrder: (order: string[]) => update((p) => ({ ...p, order })),
    resetOrganise: () => update((p) => ({ ...p, order: [], hidden: [] })),
  };
}

/** Apply the saved order: saved groups first (in order), then any new ones. */
export function orderGroups(groups: string[], order: string[]) {
  const set = new Set(groups);
  const head = order.filter((g) => set.has(g));
  const seen = new Set(head);
  return [...head, ...groups.filter((g) => !seen.has(g))];
}
