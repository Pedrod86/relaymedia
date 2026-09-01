// Browser-side helpers for Emby / Jellyfin / Plex.
//
// SECURITY: no access token is ever stored or built into a URL here. Tokens
// live in an encrypted httpOnly cookie that page JavaScript cannot read; every
// media request goes through /api/public/media-proxy, which attaches the
// credential server-side using the opaque server id.
//
// localStorage is used only for non-sensitive UI preferences (which server is
// active, which categories are hidden).

export type ServerKind = "emby" | "jellyfin" | "plex";

/** Public server metadata as returned by the server — contains no token. */
export type MediaServer = {
  id: string;
  kind: ServerKind;
  name: string;
  serverUrl: string;
  userId: string;
  userName: string;
};

const ACTIVE_KEY = "media_active_server_v1";
const HIDDEN_KEY_PREFIX = "media_hidden_views_v1:";

// Keys that used to hold access tokens in localStorage. Purge them on load so
// previously stored credentials stop lingering in browser storage.
const LEGACY_TOKEN_KEYS = ["media_servers_v1", "emby_session_v1"];

export function purgeLegacyTokenStorage() {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
}

export function getActiveServerId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveServerId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_KEY, id);
}

export function clearActiveServerId() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVE_KEY);
}

export function pickActiveServer(servers: MediaServer[]): MediaServer | null {
  if (servers.length === 0) return null;
  const id = getActiveServerId();
  return servers.find((s) => s.id === id) ?? servers[0];
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
  if (typeof window === "undefined") return;
  localStorage.setItem(HIDDEN_KEY_PREFIX + serverId, JSON.stringify(ids));
}

export function clearHiddenViews(serverId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(HIDDEN_KEY_PREFIX + serverId);
  localStorage.removeItem(ORDER_KEY_PREFIX + serverId);
}

// ── Home section order ─────────────────────────────────────────────────────
// A saved list of section ids ("resume", "latest", library view ids). Any
// section not in the list keeps its natural position at the end.
const ORDER_KEY_PREFIX = "media:order:";

export function loadSectionOrder(serverId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ORDER_KEY_PREFIX + serverId);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveSectionOrder(serverId: string, ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ORDER_KEY_PREFIX + serverId, JSON.stringify(ids));
}

export function applySectionOrder<T extends { id: string }>(
  sections: T[],
  order: string[],
): T[] {
  if (!order.length) return sections;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...sections].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}


// ── Media proxy URLs ───────────────────────────────────────────────────────
// `p` is a path (plus query) on the upstream server. The proxy resolves the
// server's base URL and token from the httpOnly cookie, so nothing secret is
// present in these URLs.

export const MEDIA_PROXY_PATH = "/api/public/media-proxy";

export function proxiedPath(serverId: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${MEDIA_PROXY_PATH}?sid=${encodeURIComponent(serverId)}&p=${encodeURIComponent(p)}`;
}

// ── Unified image URL ──────────────────────────────────────────────────────
// `item` is the normalized item shape we use throughout the UI.
// For emby/jellyfin: ImageTags.Primary/Thumb are the tag strings.
// For plex: ImageTags.Primary/Thumb are the raw thumb paths
// (e.g. "/library/metadata/123/thumb/456"). BackdropImageTags[0] holds art.
type ImageType = "Primary" | "Backdrop" | "Thumb";

type ImageItem = {
  Id: string;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentThumbImageTag?: string;
  ParentThumbItemId?: string;
  SeriesPrimaryImageTag?: string;
  SeriesId?: string;
  AlbumPrimaryImageTag?: string;
};

// Preferred image, then sensible substitutes. Many Emby/Jellyfin libraries only
// have one artwork type per item (posters but no thumbs, or backdrops only), so
// asking for a single type left cards blank.
const FALLBACKS: Record<ImageType, ImageType[]> = {
  Primary: ["Primary", "Thumb", "Backdrop"],
  Thumb: ["Thumb", "Backdrop", "Primary"],
  Backdrop: ["Backdrop", "Thumb", "Primary"],
};

function embyTag(item: ImageItem, type: ImageType): { itemId: string; tag: string } | null {
  if (type === "Backdrop") {
    const own = item.BackdropImageTags?.[0];
    if (own) return { itemId: item.Id, tag: own };
    const parent = item.ParentBackdropImageTags?.[0];
    if (parent && item.ParentBackdropItemId)
      return { itemId: item.ParentBackdropItemId, tag: parent };
    return null;
  }
  const own = item.ImageTags?.[type];
  if (own) return { itemId: item.Id, tag: own };
  if (type === "Thumb" && item.ParentThumbImageTag && item.ParentThumbItemId)
    return { itemId: item.ParentThumbItemId, tag: item.ParentThumbImageTag };
  if (type === "Primary" && item.SeriesPrimaryImageTag && item.SeriesId)
    return { itemId: item.SeriesId, tag: item.SeriesPrimaryImageTag };
  return null;
}

/**
 * Every artwork URL worth trying for an item, best first. Servers vary a lot in
 * which artwork types and tags they expose per endpoint, so the UI walks this
 * list on <img> error instead of giving up on the first miss.
 */
export function imageCandidates(
  s: MediaServer,
  item: ImageItem,
  type: ImageType = "Primary",
  opts: { maxWidth?: number } = {},
): string[] {
  const out: string[] = [];
  if (s.kind === "plex") {
    const pick = (t: ImageType) =>
      t === "Backdrop" ? item.BackdropImageTags?.[0] : item.ImageTags?.[t];
    for (const t of FALLBACKS[type]) {
      const path = pick(t);
      if (!path) continue;
      const w = opts.maxWidth ?? 400;
      const h = t === "Primary" ? Math.round(w * 1.5) : Math.round(w * 0.5625);
      // Plex photo transcoder is widely supported and returns sensible sizes.
      out.push(
        proxiedPath(
          s.id,
          `/photo/:/transcode?width=${w}&height=${h}&minSize=1&upscale=1&url=${encodeURIComponent(path)}`,
        ),
      );
      out.push(proxiedPath(s.id, path));
    }
    return [...new Set(out)];
  }

  // Emby / Jellyfin — tagged URLs first (cacheable, guaranteed to exist).
  for (const candidate of FALLBACKS[type]) {
    const hit = embyTag(item, candidate);
    if (!hit) continue;
    const params = new URLSearchParams({ quality: "90", tag: hit.tag });
    if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth));
    out.push(proxiedPath(s.id, `/Items/${hit.itemId}/Images/${candidate}?${params}`));
  }

  // Some Emby/Jellyfin versions omit ImageTags from regular /Items responses even
  // when artwork exists (while /Items/Latest includes them). The image API does
  // not require a tag, so try untagged URLs for the item and its parents too.
  const ids = [item.Id, item.SeriesId, item.ParentThumbItemId, item.ParentBackdropItemId].filter(
    (v): v is string => Boolean(v),
  );
  for (const candidate of FALLBACKS[type]) {
    for (const id of ids) {
      const params = new URLSearchParams({ quality: "90" });
      if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth));
      out.push(proxiedPath(s.id, `/Items/${id}/Images/${candidate}?${params}`));
    }
  }
  return [...new Set(out)];
}

export function imageUrl(
  s: MediaServer,
  item: ImageItem,
  type: ImageType = "Primary",
  opts: { maxWidth?: number } = {},
): string | null {
  return imageCandidates(s, item, type, opts)[0] ?? null;
}

/**
 * Item types to request for a library so recursive queries return real
 * movies/series/albums instead of folder entries (folders have no artwork).
 */
export function itemTypesFor(collectionType?: string): string | undefined {
  switch (collectionType) {
    case "movies":
      return "Movie";
    case "tvshows":
return "Series";
    case "homevideos":
      return "Video,Movie";
    case "music":
      return "MusicAlbum";
    case "boxsets":
      return "BoxSet";
    default:
      return "Movie,Series";
  }
}


// ── Streaming endpoint ─────────────────────────────────────────────────────
// One endpoint for every server kind: /api/public/stream resolves the upstream
// URL, attaches the vaulted token and rewrites HLS playlists server-side.

export const STREAM_PATH = "/api/public/stream";

export type StreamOptions = {
  mode: "hls" | "direct";
  videoCodec?: string[];
  audioCodec?: string[];
  maxBitrate?: number;
  audioChannels?: number;
  subtitleIndex?: number;
  container?: string;
  /** Stable id for one playback attempt — keeps the server transcode session warm. */
  session?: string;
  /** Seek offset in seconds for transcoded playback. */
  start?: number;
  /** HDR handling: pass the HDR10/HLG/DV grade through, or tone-map to SDR. */
  hdr?: "passthrough" | "tonemap";
  /** Vertical resolution ceiling (2160 = 4K). */
  maxHeight?: number;
  /** Frame-rate ceiling — set to the source fps so AFR cadence is preserved. */
  maxFps?: number;
  /**
   * Direct mode only: repackage the original streams into `container` instead of
   * serving the source file as-is. Used for MKV → MP4 stream-copy so E-AC3 and
   * HDR10 survive without re-encoding.
   */
  remux?: boolean;
};


export function streamUrl(s: MediaServer, itemId: string, opts: StreamOptions) {
  const params = new URLSearchParams({ sid: s.id, item: itemId, mode: opts.mode });
  if (opts.videoCodec?.length) params.set("videoCodec", opts.videoCodec.join(","));
  if (opts.audioCodec?.length) params.set("audioCodec", opts.audioCodec.join(","));
  if (opts.maxBitrate) params.set("maxBitrate", String(opts.maxBitrate));
  if (opts.audioChannels) params.set("audioChannels", String(opts.audioChannels));
  if (opts.subtitleIndex !== undefined) params.set("subtitleIndex", String(opts.subtitleIndex));
  if (opts.container) params.set("container", opts.container);
  if (opts.session) params.set("session", opts.session);
  if (opts.start) params.set("start", String(opts.start));
  if (opts.hdr) params.set("hdr", opts.hdr);
  if (opts.maxHeight) params.set("maxHeight", String(opts.maxHeight));
  if (opts.maxFps) params.set("maxFps", String(Math.round(opts.maxFps * 1000) / 1000));
  if (opts.remux) params.set("remux", "1");
  return `${STREAM_PATH}?${params}`;
}



// ── Legacy stream URLs (Emby / Jellyfin only — built client-side) ───────────
// Plex needs an extra round-trip to resolve Media.Part.key; that lives in
// plex.functions.ts.

const DEVICE_ID = "lovable-media-web";


export function embyHlsStreamUrl(s: MediaServer, itemId: string) {
  const params = new URLSearchParams();
  params.set("UserId", s.userId);
  params.set("DeviceId", DEVICE_ID);
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
  return proxiedPath(s.id, `/Videos/${itemId}/master.m3u8?${params}`);
}

export function embyDirectStreamUrl(s: MediaServer, itemId: string, container = "mp4") {
  const params = new URLSearchParams({
    UserId: s.userId,
    DeviceId: DEVICE_ID,
    Static: "true",
  });
  return proxiedPath(s.id, `/Videos/${itemId}/stream.${container}?${params}`);
}

export function plexDirectStreamUrl(s: MediaServer, partKey: string) {
  return proxiedPath(s.id, partKey);
}

// Emby/Jellyfin subtitle stream as VTT (browser-friendly).
export function embySubtitleUrl(
  s: MediaServer,
  itemId: string,
  mediaSourceId: string,
  streamIndex: number,
) {
  return proxiedPath(
    s.id,
    `/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.vtt`,
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

// ── Name cleaning ──────────────────────────────────────────────────────────
// Some servers / metadata plugins append IMDb/TMDb IDs to titles. Strip them
// so the UI shows clean, readable names everywhere.

const IMDB_ID_RE = /(?:\s*[-–—]\s*)?[\[\(\{]?\s*(?:imdb|imdbid)\s*(?:[:\s-]\s*)(tt\d{5,})\s*[\]\)\}]?/gi;
const TMDB_ID_RE = /(?:\s*[-–—]\s*)?[\[\(\{]?\s*(?:tmdb|tmdbid|tvdb|tvdbid)\s*(?:[:\s-]\s*)(\d{2,})\s*[\]\)\}]?/gi;
const TRAILING_ID_RE = /\s*[\[\(\{]\s*(tt\d{5,}|\d{6,})\s*[\]\)\}]/gi;
const LONE_ID_RE = /\s*[-–—]\s*(tt\d{5,}|\d{6,})\b/gi;

export function cleanName(name?: string | null): string {
  if (!name) return "";
  return name
    .replace(IMDB_ID_RE, "")
    .replace(TMDB_ID_RE, "")
    .replace(TRAILING_ID_RE, "")
    .replace(LONE_ID_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s[-–—]\s*$/, "")
    .trim();
}

