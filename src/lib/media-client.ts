// Multi-server session storage + URL helpers for Emby / Jellyfin / Plex.
// Browser-side only. Persists in localStorage.

export type ServerKind = "emby" | "jellyfin" | "plex";

export type MediaServer = {
  id: string;
  kind: ServerKind;
  name: string;
  serverUrl: string;
  token: string;
  userId: string; // Plex doesn't really need this — store machineIdentifier or ""
  userName: string;
};

const SERVERS_KEY = "media_servers_v1";
const ACTIVE_KEY = "media_active_server_v1";
const HIDDEN_KEY_PREFIX = "media_hidden_views_v1:";

// Legacy keys we migrate from.
const LEGACY_EMBY = "emby_session_v1";
const LEGACY_HIDDEN = "emby_hidden_views_v1";

function migrate() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SERVERS_KEY)) return;
  const legacy = localStorage.getItem(LEGACY_EMBY);
  if (!legacy) return;
  try {
    const s = JSON.parse(legacy) as { serverUrl: string; token: string; userId: string; userName: string };
    const id = `srv_${Date.now().toString(36)}`;
    const server: MediaServer = {
      id,
      kind: "emby",
      name: new URL(s.serverUrl).host,
      serverUrl: s.serverUrl.replace(/\/+$/, ""),
      token: s.token,
      userId: s.userId,
      userName: s.userName,
    };
    localStorage.setItem(SERVERS_KEY, JSON.stringify([server]));
    localStorage.setItem(ACTIVE_KEY, id);
    const legacyHidden = localStorage.getItem(LEGACY_HIDDEN);
    if (legacyHidden) localStorage.setItem(HIDDEN_KEY_PREFIX + id, legacyHidden);
  } catch {
    /* ignore */
  }
}

export function listServers(): MediaServer[] {
  if (typeof window === "undefined") return [];
  migrate();
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    return raw ? (JSON.parse(raw) as MediaServer[]) : [];
  } catch {
    return [];
  }
}

export function getActiveServerId(): string | null {
  if (typeof window === "undefined") return null;
  migrate();
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveServerId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function loadActiveServer(): MediaServer | null {
  const servers = listServers();
  if (servers.length === 0) return null;
  const id = getActiveServerId();
  return servers.find((s) => s.id === id) ?? servers[0];
}

export function addServer(s: Omit<MediaServer, "id">): MediaServer {
  const servers = listServers();
  const id = `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next: MediaServer = { ...s, id, serverUrl: s.serverUrl.replace(/\/+$/, "") };
  servers.push(next);
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  localStorage.setItem(ACTIVE_KEY, id);
  return next;
}

export function removeServer(id: string) {
  const servers = listServers().filter((s) => s.id !== id);
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  localStorage.removeItem(HIDDEN_KEY_PREFIX + id);
  const active = getActiveServerId();
  if (active === id) {
    if (servers[0]) localStorage.setItem(ACTIVE_KEY, servers[0].id);
    else localStorage.removeItem(ACTIVE_KEY);
  }
}

export function clearAllServers() {
  localStorage.removeItem(SERVERS_KEY);
  localStorage.removeItem(ACTIVE_KEY);
}

export function loadHiddenViews(serverId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HIDDEN_KEY_PREFIX + serverId);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
export function saveHiddenViews(serverId: string, ids: string[]) {
  localStorage.setItem(HIDDEN_KEY_PREFIX + serverId, JSON.stringify(ids));
}

function normalize(url: string) {
  return url.replace(/\/+$/, "");
}

// Wrap any upstream URL in our same-origin HTTPS proxy so http:// servers
// don't get blocked as mixed content.
export function proxied(target: string) {
  return `/api/public/emby-proxy?u=${encodeURIComponent(target)}`;
}

// ── Unified image URL ──────────────────────────────────────────────────────
// `item` is the normalized item shape we use throughout the UI.
// For emby/jellyfin: ImageTags.Primary/Thumb are the tag strings.
// For plex: ImageTags.Primary/Thumb are the raw thumb paths
// (e.g. "/library/metadata/123/thumb/456"). BackdropImageTags[0] holds art.
export function imageUrl(
  s: MediaServer,
  item: { Id: string; ImageTags?: Record<string, string>; BackdropImageTags?: string[] },
  type: "Primary" | "Backdrop" | "Thumb" = "Primary",
  opts: { maxWidth?: number } = {}
): string | null {
  if (s.kind === "plex") {
    const path = type === "Backdrop" ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
    if (!path) return null;
    const w = opts.maxWidth ?? 400;
    const h = type === "Primary" ? Math.round(w * 1.5) : Math.round(w * 0.5625);
    // Plex photo transcoder is widely supported and returns sensible sizes.
    const target =
      `${normalize(s.serverUrl)}/photo/:/transcode?width=${w}&height=${h}` +
      `&minSize=1&upscale=1&url=${encodeURIComponent(path)}&X-Plex-Token=${encodeURIComponent(s.token)}`;
    return proxied(target);
  }
  // Emby / Jellyfin
  const tag = type === "Backdrop" ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
  if (!tag) return null;
  const params = new URLSearchParams({ quality: "90", tag });
  if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth));
  return proxied(`${normalize(s.serverUrl)}/Items/${item.Id}/Images/${type}?${params}`);
}

// ── Stream URLs (Emby / Jellyfin only — built client-side) ─────────────────
// Plex needs an extra round-trip to resolve Media.Part.key; that lives in
// plex.functions.ts.

export function embyHlsStreamUrl(s: MediaServer, itemId: string) {
  const params = new URLSearchParams();
  params.set("UserId", s.userId);
  params.set("DeviceId", "lovable-media-web");
  params.set("api_key", s.token);
  params.set("PlaySessionId", `lovable-${itemId}-${Date.now()}`);
  params.set("VideoCodec", "h264,hevc");
  params.set("AudioCodec", "aac,mp3");
  params.set("AudioStreamIndex", "1");
  params.set("VideoBitrate", "8000000");
  params.set("AudioBitrate", "192000");
  params.set("MaxAudioChannels", "2");
  params.set("TranscodingMaxAudioChannels", "2");
  params.set("SegmentContainer", "ts");
  params.set("MinSegments", "1");
  params.set("BreakOnNonKeyFrames", "True");
  params.set("h264-profile", "high,main,baseline");
  params.set("h264-level", "51");
  return proxied(`${normalize(s.serverUrl)}/Videos/${itemId}/master.m3u8?${params}`);
}

export function embyDirectStreamUrl(s: MediaServer, itemId: string, container = "mp4") {
  const params = new URLSearchParams({
    UserId: s.userId,
    DeviceId: "lovable-media-web",
    api_key: s.token,
    Static: "true",
  });
  return proxied(`${normalize(s.serverUrl)}/Videos/${itemId}/stream.${container}?${params}`);
}

export function plexDirectStreamUrl(s: MediaServer, partKey: string) {
  const path = partKey.startsWith("/") ? partKey : `/${partKey}`;
  return proxied(`${normalize(s.serverUrl)}${path}?X-Plex-Token=${encodeURIComponent(s.token)}`);
}

// Emby/Jellyfin subtitle stream as VTT (browser-friendly).
export function embySubtitleUrl(
  s: MediaServer,
  itemId: string,
  mediaSourceId: string,
  streamIndex: number,
) {
  return proxied(
    `${normalize(s.serverUrl)}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.vtt?api_key=${encodeURIComponent(s.token)}`,
  );
}

export function ticksToTime(ticks?: number) {
  if (!ticks) return "";
  const totalSec = Math.floor(ticks / 10_000_000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}
