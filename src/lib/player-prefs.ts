// Player preferences + browser codec capability probing.
//
// Stored in localStorage — these are non-sensitive UI/playback preferences only.

import type { AfrMode } from "./afr";
import { isAndroidNative, isTvDevice } from "./platform";


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
  /**
   * Automatic frame rate matching.
   * off    — leave cadence alone
   * auto   — preserve source fps, correct only when it would judder
   * strict — always align the source cadence to the display refresh rate
   */
  afr: AfrMode;
};

export const DEFAULT_PREFS: PlayerPrefs = {
  decode: "auto",
  playback: "auto",
  maxBitrate: 20_000_000,
  autoSubtitles: false,
  hdr: "auto",
  maxHeight: 2160,
  afr: "auto",
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

// ── Container & platform playback environment ──────────────────────────────
// The Android APK plays through the platform media stack, which handles things
// the plain web player cannot: Matroska (MKV) containers, Dolby Digital /
// Digital Plus (AC3 / E-AC3) audio, and 10-bit HDR10 video. Detect that so the
// player asks the server to stream-copy instead of transcoding.

export type PlaybackEnv = {
  /** Running inside the Android APK — platform decoders are available. */
  androidNative: boolean;
  /** MKV / Matroska can be played without remuxing. */
  mkv: boolean;
  /** AC3 / E-AC3 audio can be passed through untouched. */
  eac3: boolean;
  /** HDR10 (PQ, 10-bit) can be displayed without tone mapping. */
  hdr10: boolean;
};

export const WEB_ENV: PlaybackEnv = { androidNative: false, mkv: false, eac3: false, hdr10: false };

const MKV_TYPES = [
  'video/x-matroska; codecs="avc1.640028,mp4a.40.2"',
  "video/x-matroska",
  "video/mkv",
];
const EAC3_TYPES = ['audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="ac-3"', "audio/eac3", "audio/ac3"];

export function detectPlaybackEnv(): PlaybackEnv {
  if (typeof window === "undefined") return WEB_ENV;
  const v = document.createElement("video");
  const can = (t: string) => {
    try {
      return v.canPlayType(t) !== "";
    } catch {
      return false;
    }
  };
  const androidNative = isAndroidNative();
  const hdrDisplay =
    isTvDevice() ||
    window.matchMedia?.("(dynamic-range: high)").matches === true ||
    window.matchMedia?.("(video-dynamic-range: high)").matches === true;
  return {
    androidNative,
    mkv: androidNative || MKV_TYPES.some(can),
    eac3: androidNative || EAC3_TYPES.some(can),
    hdr10: androidNative && hdrDisplay,
  };
}

/** Containers the current environment can play without a server-side remux. */
export function playableContainers(env: PlaybackEnv): string[] {
  return env.mkv ? [...DIRECT_CONTAINERS, "mkv", "matroska"] : DIRECT_CONTAINERS;
}


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

// ── HDR / Dolby Vision display capability ──────────────────────────────────

export type HdrSupport = {
  /** Display reports a high dynamic range (10-bit+, wide luminance). */
  hdrDisplay: boolean;
  /** PQ transfer function decodable → HDR10 / HDR10+ passthrough possible. */
  hdr10: boolean;
  /** HLG transfer function decodable. */
  hlg: boolean;
  /** A Dolby Vision codec profile is decodable (usually Safari / Apple, Edge on DV TVs). */
  dolbyVision: boolean;
  /** 10-bit HEVC decode (required for most 4K HDR sources). */
  hevcMain10: boolean;
  /** Platform can decode 3840×2160 at 60fps power-efficiently. */
  uhdHardware: boolean;
};

export const NO_HDR: HdrSupport = {
  hdrDisplay: false,
  hdr10: false,
  hlg: false,
  dolbyVision: false,
  hevcMain10: false,
  uhdHardware: false,
};

/** Probe the display + decoder for 4K, HDR10/HLG and Dolby Vision support. */
export async function probeHdr(caps?: CodecCap[]): Promise<HdrSupport> {
  if (typeof window === "undefined") return NO_HDR;
  const list = caps ?? (await probeCodecs());
  const mc = (navigator as any).mediaCapabilities;

  const hdrDisplay =
    window.matchMedia?.("(dynamic-range: high)").matches ||
    window.matchMedia?.("(video-dynamic-range: high)").matches ||
    false;

  async function transfer(fn: "pq" | "hlg") {
    if (!mc?.decodingInfo) return false;
    try {
      const info = await mc.decodingInfo({
        type: "media-source",
        video: {
          contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
          width: 3840,
          height: 2160,
          bitrate: 40_000_000,
          framerate: 24,
          transferFunction: fn,
          colorGamut: "rec2020",
          hdrMetadataType: fn === "pq" ? "smpteSt2086" : undefined,
        },
      });
      return !!info.supported;
    } catch {
      return false;
    }
  }

  async function uhd() {
    if (!mc?.decodingInfo) return false;
    try {
      const info = await mc.decodingInfo({
        type: "media-source",
        video: {
          contentType: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
          width: 3840,
          height: 2160,
          bitrate: 40_000_000,
          framerate: 60,
        },
      });
      return !!info.supported && !!info.powerEfficient;
    } catch {
      return false;
    }
  }

  const hevcMain10 = !!list.find((c) => c.name === "hevc10")?.supported;
  const dolbyVision = list.some((c) => (c.name === "dvhe5" || c.name === "dvhe8") && c.supported);
  const [pq, hlg, uhdHardware] = await Promise.all([transfer("pq"), transfer("hlg"), uhd()]);

  return {
    hdrDisplay,
    hdr10: pq && hevcMain10,
    hlg: hlg && hevcMain10,
    dolbyVision,
    hevcMain10,
    uhdHardware,
  };
}

/** Should HDR/DV be passed through untouched, given prefs + capabilities? */
export function wantsHdrPassthrough(prefs: PlayerPrefs, hdr: HdrSupport) {
  if (prefs.hdr === "sdr") return false;
  if (prefs.hdr === "passthrough") return true;
  return hdr.hdrDisplay && (hdr.hdr10 || hdr.hlg || hdr.dolbyVision);
}

/** Map our probe names onto the codec names media servers understand. */
const SERVER_CODEC: Record<string, string> = {
  hevc10: "hevc",
  dvhe5: "hevc",
  dvhe8: "hevc",
  av1_10bit: "av1",
};

/** Codecs we are willing to ask the server for, given the decode preference. */
export function allowedCodecs(caps: CodecCap[], prefs: PlayerPrefs, track: "video" | "audio") {
  const pool = caps.filter((c) => c.track === track && c.supported);
  const names = (list: CodecCap[]) => [...new Set(list.map((c) => SERVER_CODEC[c.name] ?? c.name))];
  if (prefs.decode === "hardware") {
    const hw = pool.filter((c) => c.hardware);
    if (hw.length) return names(hw);
  }
  if (prefs.decode === "software") {
    // Prefer the most broadly-decodable codecs; skip exotic hardware-only ones.
    const soft = pool.filter((c) => ["h264", "vp9", "aac", "mp3", "opus"].includes(c.name));
    if (soft.length) return names(soft);
  }
  return names(pool);
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
  /** SDR | HDR10 | HDR10+ | HLG | DOVI (as reported by the server). */
  videoRange: string;
  isHdr: boolean;
  isDolbyVision: boolean;
  is4K: boolean;
  /** True when the HDR/DV grade will be delivered untouched. */
  hdrPassthrough: boolean;
  /** True when the server must tone-map HDR down to SDR. */
  toneMapping: boolean;
  /** Container to ask for on a direct stream ("mkv" = original, no remux). */
  directContainer: string;
  /** True when the container is repackaged (stream-copy) rather than transcoded. */
  remux: boolean;
  /** True when the original audio track (e.g. E-AC3) is sent untouched. */
  audioPassthrough: boolean;
  notes: string[];
};


const DIRECT_CONTAINERS = ["mp4", "m4v", "mov", "webm"];

function rangeOf(v: any): string {
  const raw = String(v?.VideoRangeType ?? v?.VideoRange ?? "SDR").toUpperCase();
  if (raw.includes("DOVI") || raw.includes("DOLBY")) return "DOVI";
  if (raw.includes("HDR10PLUS") || raw.includes("HDR10+")) return "HDR10+";
  if (raw.includes("HDR10")) return "HDR10";
  if (raw.includes("HLG")) return "HLG";
  if (raw.includes("HDR")) return "HDR10";
  return "SDR";
}

/**
 * Compare an Emby/Jellyfin item's media streams against browser capabilities to
 * decide whether it can direct-play (including 4K HDR10 / Dolby Vision
 * passthrough) or should be transcoded / tone-mapped to HLS.
 */
export function checkItemPlayback(
  item: any,
  caps: CodecCap[],
  prefs: PlayerPrefs,
  hdrSupport: HdrSupport = NO_HDR,
  env: PlaybackEnv = WEB_ENV,
): StreamCheck {

  const source = item?.MediaSources?.[0];
  const streams: any[] = source?.MediaStreams ?? item?.MediaStreams ?? [];
  const v = streams.find((s) => s.Type === "Video");
  const a = streams.find((s) => s.Type === "Audio");
  const container = (source?.Container ?? item?.Container ?? "").toLowerCase() || undefined;
  const videoCodec = (v?.Codec ?? "").toLowerCase() || undefined;
  const audioCodec = (a?.Codec ?? "").toLowerCase() || undefined;

  const videoRange = rangeOf(v);
  const isDolbyVision = videoRange === "DOVI" || !!v?.DvProfile || !!v?.DvVersionMajor;
  const isHdr = videoRange !== "SDR";
  const bitDepth = Number(v?.BitDepth ?? (isHdr ? 10 : 8));
  const is4K = Number(v?.Width ?? 0) >= 3400 || Number(v?.Height ?? 0) >= 2000;

  // A 10-bit HEVC HDR stream needs the Main10 profile, not plain HEVC.
  const needsMain10 = bitDepth >= 10 || isHdr;
  const capName =
    videoCodec === "hevc" && needsMain10
      ? "hevc10"
      : videoCodec === "av1" && needsMain10
        ? "av1_10bit"
        : videoCodec;
  const dvCap = caps.find((c) => (c.name === "dvhe5" || c.name === "dvhe8") && c.supported);
  const vCap = isDolbyVision ? (dvCap ?? caps.find((c) => c.name === capName)) : caps.find((c) => c.track === "video" && c.name === capName);
  const aCap = caps.find((c) => c.track === "audio" && c.name === audioCodec);

  const notes: string[] = [];
  // The Android APK plays HEVC / HEVC Main10 through the platform decoder even
  // when MediaCapabilities (a MSE-only API) reports nothing for it.
  const nativeVideoOk =
    env.androidNative && ["h264", "hevc", "av1", "vp9", "mpeg2video"].includes(videoCodec ?? "");
  const videoSupported = !!vCap?.supported || nativeVideoOk;
  const videoHardware = !!vCap?.hardware || nativeVideoOk;
  // AC3 / E-AC3 (Dolby Digital / Digital Plus) are decoded — or bitstreamed to
  // the receiver — by the Android media stack, so no re-encode is needed.
  const nativeAudioOk = env.eac3 && ["eac3", "ec-3", "ac3", "ac-3"].includes(audioCodec ?? "");
  const audioSupported = !!aCap?.supported || nativeAudioOk;
  const audioPassthrough = audioSupported;

  const passthroughWanted = isHdr && wantsHdrPassthrough(prefs, hdrSupport);
  const canPassHdr =
    passthroughWanted &&
    videoSupported &&
    (isDolbyVision
      ? hdrSupport.dolbyVision || env.androidNative || prefs.hdr === "passthrough"
      : hdrSupport.hdr10 || hdrSupport.hlg || env.hdr10 || prefs.hdr === "passthrough");
  const toneMapping = isHdr && !canPassHdr;

  const directContainers = playableContainers(env);
  const containerOk = !!container && directContainers.includes(container);
  const directContainer = containerOk && (container === "mkv" || container === "matroska") ? "mkv" : "mp4";



  if (videoCodec && !videoSupported)
    notes.push(`${videoCodec.toUpperCase()}${needsMain10 ? " 10-bit" : ""} video isn't decodable here — will transcode.`);
  if (videoSupported && !videoHardware) notes.push(`${videoCodec?.toUpperCase()} decodes in software on this device.`);
  if (audioCodec && !audioSupported) notes.push(`${audioCodec.toUpperCase()} audio isn't supported — will be re-encoded to AAC.`);
  else if (nativeAudioOk) notes.push(`${audioCodec?.toUpperCase()} audio passed through to the device decoder.`);
  if (container && !containerOk) notes.push(`${container.toUpperCase()} container will be repackaged (no re-encode).`);
  else if (directContainer === "mkv") notes.push("MKV played directly — original container kept.");
  if (prefs.decode === "hardware" && videoSupported && !videoHardware)
    notes.push("Hardware-only decoding is on, so the server will transcode to a GPU-friendly codec.");
  if (is4K && !hdrSupport.uhdHardware && !env.androidNative)
    notes.push("4K isn't confirmed as hardware-decodable here — playback may drop frames.");
  if (isDolbyVision)
    notes.push(
      canPassHdr
        ? "Dolby Vision passthrough — original grade sent untouched."
        : "Dolby Vision source: base layer will be tone-mapped for this display.",
    );
  else if (isHdr)
    notes.push(canPassHdr ? `${videoRange} passthrough — original grade sent untouched.` : `${videoRange} will be tone-mapped to SDR.`);
  if (is4K && prefs.maxHeight < 2160) notes.push(`4K source downscaled to ${prefs.maxHeight}p by your resolution cap.`);

  // Direct play covers stream-copy remuxes too: when the codecs are decodable
  // but the container isn't (MKV in the web player), the server repackages the
  // same elementary streams into MP4 instead of re-encoding.
  let canDirectPlay = videoSupported && audioSupported && !!container && !toneMapping;

  if (prefs.decode === "hardware" && !videoHardware) canDirectPlay = false;
  if (is4K && prefs.maxHeight < 2160) canDirectPlay = false;

  const bitrate = source?.Bitrate ?? v?.BitRate;
  if (canDirectPlay && bitrate && bitrate > prefs.maxBitrate) {
    canDirectPlay = false;
    notes.push("Source bitrate is above your quality cap — will transcode.");
  }

  const recommended: "direct" | "hls" =
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
    videoRange,
    isHdr,
    isDolbyVision,
    is4K,
    hdrPassthrough: canPassHdr,
    toneMapping,
    directContainer,
    remux: canDirectPlay && !containerOk,
    audioPassthrough,
    notes,

  };
}

