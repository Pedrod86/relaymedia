// Player preferences + browser codec capability probing.
//
// Stored in localStorage — these are non-sensitive UI/playback preferences only.

export type DecodeMode = "auto" | "hardware" | "software";
export type PlaybackMode = "auto" | "hls" | "direct";
/** How to handle HDR10 / HLG / Dolby Vision sources. */
export type HdrMode = "auto" | "passthrough" | "sdr";

export type PlayerPrefs = {
  /** Hardware = only use codecs the GPU can decode power-efficiently. */
  decode: DecodeMode;
  /** How to request the stream: adaptive HLS, direct file, or automatic. */
  playback: PlaybackMode;
  /** Ceiling for transcoded video, in bits per second. */
  maxBitrate: number;
  /** Turn on the first text subtitle track automatically. */
  autoSubtitles: boolean;
  /**
   * auto        — pass HDR/DV through when the display supports it, tone-map otherwise
   * passthrough — always ask for the original HDR/DV stream (no tone mapping)
   * sdr         — always tone-map to SDR
   */
  hdr: HdrMode;
  /** Vertical resolution ceiling (2160 = 4K). */
  maxHeight: number;
};

export const DEFAULT_PREFS: PlayerPrefs = {
  decode: "auto",
  playback: "auto",
  maxBitrate: 20_000_000,
  autoSubtitles: false,
  hdr: "auto",
  maxHeight: 2160,
};

const KEY = "media_player_prefs_v1";

export function loadPlayerPrefs(): PlayerPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PlayerPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePlayerPrefs(p: PlayerPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export const BITRATE_OPTIONS = [
  { value: 4_000_000, label: "4 Mbps (mobile data)" },
  { value: 8_000_000, label: "8 Mbps (720p/1080p)" },
  { value: 20_000_000, label: "20 Mbps (1080p high)" },
  { value: 40_000_000, label: "40 Mbps (4K)" },
  { value: 80_000_000, label: "80 Mbps (4K HDR)" },
  { value: 120_000_000, label: "Unlimited (original)" },
];

export const RESOLUTION_OPTIONS = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p" },
  { value: 2160, label: "4K (2160p)" },
];


// ── Codec probing ──────────────────────────────────────────────────────────

export type CodecCap = {
  /** Codec short name as media servers report it (h264, hevc, aac, …). */
  name: string;
  label: string;
  track: "video" | "audio";
  contentType: string;
  supported: boolean;
  /** True when the platform reports power-efficient (i.e. hardware) decoding. */
  hardware: boolean;
};

type Probe = Omit<CodecCap, "supported" | "hardware">;

const VIDEO_PROBES: Probe[] = [
  { name: "h264", label: "H.264 / AVC", track: "video", contentType: 'video/mp4; codecs="avc1.640028"' },
  { name: "hevc", label: "H.265 / HEVC", track: "video", contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  // 10-bit HEVC Main10 at Level 5.1 = the 4K HDR10 / HLG profile.
  { name: "hevc10", label: "HEVC Main10 (4K HDR)", track: "video", contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"' },
  // Dolby Vision: profile 5 (single-layer IPTPQc2) and profile 8.1 (HDR10 base).
  { name: "dvhe5", label: "Dolby Vision (profile 5)", track: "video", contentType: 'video/mp4; codecs="dvh1.05.06"' },
  { name: "dvhe8", label: "Dolby Vision (profile 8.1)", track: "video", contentType: 'video/mp4; codecs="dvh1.08.06"' },
  { name: "vp9", label: "VP9", track: "video", contentType: 'video/webm; codecs="vp9"' },
  { name: "av1", label: "AV1", track: "video", contentType: 'video/mp4; codecs="av01.0.08M.08"' },
  { name: "av1_10bit", label: "AV1 10-bit (HDR)", track: "video", contentType: 'video/mp4; codecs="av01.0.12M.10"' },
  { name: "mpeg2video", label: "MPEG-2", track: "video", contentType: 'video/mp4; codecs="mp4v.20.8"' },
];


const AUDIO_PROBES: Probe[] = [
  { name: "aac", label: "AAC", track: "audio", contentType: 'audio/mp4; codecs="mp4a.40.2"' },
  { name: "mp3", label: "MP3", track: "audio", contentType: 'audio/mpeg' },
  { name: "ac3", label: "Dolby Digital (AC3)", track: "audio", contentType: 'audio/mp4; codecs="ac-3"' },
  { name: "eac3", label: "Dolby Digital+ (E-AC3)", track: "audio", contentType: 'audio/mp4; codecs="ec-3"' },
  { name: "opus", label: "Opus", track: "audio", contentType: 'audio/webm; codecs="opus"' },
  { name: "flac", label: "FLAC", track: "audio", contentType: 'audio/mp4; codecs="flac"' },
];

/**
 * Probe the browser for codec support and hardware-decode capability.
 * Uses MediaCapabilities when available (it reports `powerEfficient`, i.e.
 * hardware decoding) and falls back to canPlayType / MediaSource.
 */
export async function probeCodecs(): Promise<CodecCap[]> {
  if (typeof window === "undefined") return [];
  const video = document.createElement("video");
  const mc = (navigator as any).mediaCapabilities;

  async function probe(p: Probe): Promise<CodecCap> {
    let supported = false;
    let hardware = false;

    if (mc?.decodingInfo) {
      try {
        const cfg =
          p.track === "video"
            ? {
                type: "media-source",
                video: { contentType: p.contentType, width: 1920, height: 1080, bitrate: 5_000_000, framerate: 24 },
              }
            : { type: "media-source", audio: { contentType: p.contentType } };
        const info = await mc.decodingInfo(cfg);
        supported = !!info.supported;
        hardware = !!info.powerEfficient;
      } catch {
        /* fall through to the legacy checks */
      }
    }

    if (!supported) {
      const ms = (window as any).MediaSource;
      supported =
        (ms?.isTypeSupported?.(p.contentType) ?? false) ||
        video.canPlayType(p.contentType) === "probably";
    }

    return { ...p, supported, hardware };
  }

  return Promise.all([...VIDEO_PROBES, ...AUDIO_PROBES].map(probe));
}

/** Codecs we are willing to ask the server for, given the decode preference. */
export function allowedCodecs(caps: CodecCap[], prefs: PlayerPrefs, track: "video" | "audio") {
  const pool = caps.filter((c) => c.track === track && c.supported);
  if (prefs.decode === "hardware") {
    const hw = pool.filter((c) => c.hardware);
    if (hw.length) return hw.map((c) => c.name);
  }
  if (prefs.decode === "software") {
    // Prefer the most broadly-decodable codecs; skip exotic hardware-only ones.
    const soft = pool.filter((c) => ["h264", "vp9", "aac", "mp3", "opus"].includes(c.name));
    if (soft.length) return soft.map((c) => c.name);
  }
  return pool.map((c) => c.name);
}

// ── Item validation ────────────────────────────────────────────────────────

export type StreamCheck = {
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  videoSupported: boolean;
  videoHardware: boolean;
  audioSupported: boolean;
  canDirectPlay: boolean;
  recommended: "direct" | "hls";
  notes: string[];
};

const DIRECT_CONTAINERS = ["mp4", "m4v", "mov", "webm"];

/**
 * Compare an Emby/Jellyfin item's media streams against browser capabilities to
 * decide whether it can direct-play or should be transcoded to HLS.
 */
export function checkItemPlayback(item: any, caps: CodecCap[], prefs: PlayerPrefs): StreamCheck {
  const source = item?.MediaSources?.[0];
  const streams: any[] = source?.MediaStreams ?? item?.MediaStreams ?? [];
  const v = streams.find((s) => s.Type === "Video");
  const a = streams.find((s) => s.Type === "Audio");
  const container = (source?.Container ?? item?.Container ?? "").toLowerCase() || undefined;
  const videoCodec = (v?.Codec ?? "").toLowerCase() || undefined;
  const audioCodec = (a?.Codec ?? "").toLowerCase() || undefined;

  const vCap = caps.find((c) => c.track === "video" && c.name === videoCodec);
  const aCap = caps.find((c) => c.track === "audio" && c.name === audioCodec);

  const notes: string[] = [];
  const videoSupported = !!vCap?.supported;
  const videoHardware = !!vCap?.hardware;
  const audioSupported = !!aCap?.supported;

  if (videoCodec && !videoSupported) notes.push(`${videoCodec.toUpperCase()} video isn't decodable here — will transcode.`);
  if (videoSupported && !videoHardware) notes.push(`${videoCodec?.toUpperCase()} decodes in software on this device.`);
  if (audioCodec && !audioSupported) notes.push(`${audioCodec.toUpperCase()} audio isn't supported — will be re-encoded to AAC.`);
  if (container && !DIRECT_CONTAINERS.includes(container)) notes.push(`${container.toUpperCase()} container needs remuxing.`);
  if (prefs.decode === "hardware" && videoSupported && !videoHardware)
    notes.push("Hardware-only decoding is on, so the server will transcode to a GPU-friendly codec.");

  let canDirectPlay =
    videoSupported &&
    audioSupported &&
    !!container &&
    DIRECT_CONTAINERS.includes(container);
  if (prefs.decode === "hardware" && !videoHardware) canDirectPlay = false;

  const bitrate = source?.Bitrate ?? v?.BitRate;
  if (canDirectPlay && bitrate && bitrate > prefs.maxBitrate) {
    canDirectPlay = false;
    notes.push("Source bitrate is above your quality cap — will transcode.");
  }

  let recommended: "direct" | "hls" =
    prefs.playback === "direct" ? "direct" : prefs.playback === "hls" ? "hls" : canDirectPlay ? "direct" : "hls";

  if (canDirectPlay && notes.length === 0) notes.push("Direct play — no transcoding needed.");

  return {
    container,
    videoCodec,
    audioCodec,
    resolution: v?.Width && v?.Height ? `${v.Width}×${v.Height}` : undefined,
    videoSupported,
    videoHardware,
    audioSupported,
    canDirectPlay,
    recommended,
    notes,
  };
}
