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
  const params = new URLSearchParams({
    UserId: s.userId,
    DeviceId: "lovable-emby-web",
    api_key: s.token,
    VideoCodec: "h264,hevc",
    AudioCodec: "aac,mp3",
    AudioStreamIndex: "1",
    VideoBitrate: "8000000",
    AudioBitrate: "192000",
    MaxAudioChannels: "2",
    TranscodingMaxAudioChannels: "2",
    SegmentContainer: "ts",
    MinSegments: "1",
    BreakOnNonKeyFrames: "True",
    h264-profile: "high,main,baseline" as unknown as string,
  } as Record<string, string>);
  // remove the bad key from above; use proper key
  params.delete("h264-profile");
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
