// Back-compat shim. All real logic now lives in media-client.ts (multi-server,
// supports Emby / Jellyfin / Plex). Kept so any stale imports still resolve.
export {
  listServers,
  loadActiveServer,
  loadActiveServer as loadSession,
  getActiveServerId,
  setActiveServerId,
  addServer,
  removeServer,
  clearAllServers,
  loadHiddenViews,
  saveHiddenViews,
  imageUrl,
  ticksToTime,
  embyHlsStreamUrl as hlsStreamUrl,
  embyDirectStreamUrl as directStreamUrl,
  plexDirectStreamUrl,
  type MediaServer,
  type MediaServer as EmbySession,
  type ServerKind,
} from "./media-client";

export function clearSession() {
  // legacy single-session signout — clear everything
  if (typeof window !== "undefined") {
    localStorage.removeItem("media_servers_v1");
    localStorage.removeItem("media_active_server_v1");
    localStorage.removeItem("emby_session_v1");
  }
}
