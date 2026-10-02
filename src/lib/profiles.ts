// Local viewer profiles (e.g. Dad, Mom, Kids). Each profile keeps its own
// watch history, favourites and Watch Later. Kids profiles hide Live TV and
// TorBox and filter out mature ratings; a PIN can lock a profile.

export type Profile = {
  id: string;
  name: string;
  color: string;
  kids: boolean;
  pin?: string;
};

const LIST_KEY = "relay:profiles";
const ACTIVE_KEY = "relay:active-profile";
const EVENT = "relay:profile-change";

export const DEFAULT_PROFILE: Profile = { id: "default", name: "Main", color: "#22d3ee", kids: false };

export function loadProfiles(): Profile[] {
  if (typeof window === "undefined") return [DEFAULT_PROFILE];
  try {
    const list = JSON.parse(localStorage.getItem(LIST_KEY) || "[]") as Profile[];
    const rest = list.filter((p) => p.id !== DEFAULT_PROFILE.id);
    const main = list.find((p) => p.id === DEFAULT_PROFILE.id) ?? DEFAULT_PROFILE;
    return [main, ...rest];
  } catch {
    return [DEFAULT_PROFILE];
  }
}

export function saveProfiles(list: Profile[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
  document.dispatchEvent(new Event(EVENT));
}

export function activeProfileId(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILE.id;
  return localStorage.getItem(ACTIVE_KEY) || DEFAULT_PROFILE.id;
}

export function activeProfile(): Profile {
  const id = activeProfileId();
  return loadProfiles().find((p) => p.id === id) ?? DEFAULT_PROFILE;
}

export function setActiveProfile(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  document.dispatchEvent(new Event(EVENT));
}

/** Storage-key suffix; empty for the main profile so existing data is kept. */
export function profileSuffix(): string {
  const id = activeProfileId();
  return id === DEFAULT_PROFILE.id ? "" : `@${id}`;
}

export function onProfileChange(fn: () => void) {
  document.addEventListener(EVENT, fn);
  return () => document.removeEventListener(EVENT, fn);
}

const MATURE = /^(R|NC-17|TV-MA|18|R18|X|NR|UNRATED|15|MA15\+|R18\+|FSK-?1[68]|16|18\+)$/i;

/** True if a title is suitable to show on a kids profile. */
export function kidsSafe(item: any): boolean {
  const r = String(item?.OfficialRating ?? item?.contentRating ?? "").trim();
  if (!r) return true;
  return !MATURE.test(r.replace(/^[A-Z]{2}-/, ""));
}

import { useEffect, useState } from "react";

/** Reactive current profile (hydration-safe: starts as Main). */
export function useActiveProfile(): Profile {
  const [p, setP] = useState<Profile>(DEFAULT_PROFILE);
  useEffect(() => {
    const sync = () => setP(activeProfile());
    sync();
    return onProfileChange(sync);
  }, []);
  return p;
}
