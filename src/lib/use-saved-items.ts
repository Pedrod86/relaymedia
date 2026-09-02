import { useCallback, useEffect, useState } from "react";
import {
  isSaved,
  loadSaved,
  onSavedChange,
  savedToItem,
  toggleSaved,
  type SavedList,
} from "./saved-items";

/** Live view of one saved list (favourites or watch later) for a server. */
export function useSavedList(serverId: string, list: SavedList) {
  const [entries, setEntries] = useState<ReturnType<typeof loadSaved>>([]);

  useEffect(() => {
    const read = () => setEntries(loadSaved(serverId, list));
    read();
    return onSavedChange(read);
  }, [serverId, list]);

  return { entries, items: entries.map(savedToItem) };
}

/** Saved state for a single item, with a toggle. */
export function useSavedItem(serverId: string, list: SavedList, item: any) {
  const id = item?.Id ? String(item.Id) : "";
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    const read = () => setSaved(isSaved(serverId, list, id));
    read();
    return onSavedChange(read);
  }, [serverId, list, id]);

  const toggle = useCallback(() => {
    if (!item?.Id) return false;
    return toggleSaved(serverId, list, item);
  }, [serverId, list, item]);

  return { saved, toggle };
}
