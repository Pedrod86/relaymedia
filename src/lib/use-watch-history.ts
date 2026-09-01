import { useEffect, useRef, useState } from "react";
import {
  loadHistory,
  onHistoryChange,
  recordWatch,
  topGenres,
  type HistoryEntry,
} from "./watch-history";

/** Live view of the watch history for one server. */
export function useWatchHistory(serverId: string) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const read = () => setHistory(loadHistory(serverId));
    read();
    return onHistoryChange(read);
  }, [serverId]);

  return {
    history,
    watched: history.filter((e) => e.completed),
    inProgress: history.filter((e) => !e.completed && e.progress > 2),
    genres: topGenres(history),
  };
}

/**
 * Writes playback progress into the history as the user watches: once on play,
 * every ~15s, and on pause/end/unmount so the last position is never lost.
 */
export function useHistoryRecorder(
  video: React.RefObject<HTMLVideoElement | null>,
  serverId: string,
  item: any,
) {
  const itemRef = useRef<any>(item);
  itemRef.current = item;

  useEffect(() => {
    const el = video.current;
    if (!el || !item?.Id) return;

    const pct = () =>
      el.duration && Number.isFinite(el.duration)
        ? (el.currentTime / el.duration) * 100
        : 0;

    let last = 0;
    const write = (progress: number) => {
      recordWatch(serverId, itemRef.current, progress);
      last = Date.now();
    };

    const onPlaying = () => write(pct());
    const onTime = () => {
      if (Date.now() - last > 15_000) write(pct());
    };
    const onPause = () => write(pct());
    const onEnded = () => write(100);

    el.addEventListener("playing", onPlaying);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      if (el.currentTime > 0) write(el.ended ? 100 : pct());
    };
  }, [video, serverId, item?.Id]);
}
