// Browser-side helpers: session storage + direct stream URLs (so video bytes
// don't proxy through our server).

export type EmbySession = {
  serverUrl: string;
  token: string;
  userId: string;
  userName: string;
};

const KEY = "emby_session_v1";

export function saveSession(s: EmbySession) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function loadSession(): EmbySession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EmbySession) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(KEY);
}

function normalize(url: string) {
  return url.replace(/\/+$/, "");
}

export function imageUrl(
  s: EmbySession,
  itemId: string,
  type: "Primary" | "Backdrop" | "Thumb" = "Primary",
  opts: { maxWidth?: number; tag?: string } = {}
) {
  const params = new URLSearchParams({ quality: "90" });
  if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth));
  if (opts.tag) params.set("tag", opts.tag);
  return `${normalize(s.serverUrl)}/Items/${itemId}/Images/${type}?${params}`;
}

// HLS master playlist — broadly compatible, lets the browser pick the best
// decode path (hardware where available, software fallback otherwise).
export function hlsStreamUrl(s: EmbySession, itemId: string) {
  const params = new URLSearchParams();
  params.set("UserId", s.userId);
  params.set("DeviceId", "lovable-emby-web");
  params.set("api_key", s.token);
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
  return `${normalize(s.serverUrl)}/Videos/${itemId}/master.m3u8?${params}`;
}

// Direct MP4 stream URL — used as a fallback / for already-compatible files.
export function directStreamUrl(s: EmbySession, itemId: string, container = "mp4") {
  const params = new URLSearchParams({
    UserId: s.userId,
    DeviceId: "lovable-emby-web",
    api_key: s.token,
    Static: "true",
  });
  return `${normalize(s.serverUrl)}/Videos/${itemId}/stream.${container}?${params}`;
}

export function ticksToTime(ticks?: number) {
  if (!ticks) return "";
  const totalSec = Math.floor(ticks / 10_000_000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}
