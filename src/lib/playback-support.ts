// Browser playback capability detection. Reports which codecs and containers
// the current browser claims to support via MediaSource / HTMLVideoElement.
// All checks are best-effort — browsers can lie either way.

export type PlaybackSupport = {
  video: string[];
  audio: string[];
  containers: string[];
  hdr: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  h264: boolean;
};

const VIDEO_CODECS: Array<{ label: string; type: string }> = [
  { label: "H.264 (AVC)", type: 'video/mp4; codecs="avc1.640028"' },
  { label: "H.265 (HEVC) Main", type: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  { label: "H.265 (HEVC) Main10", type: 'video/mp4; codecs="hvc1.2.4.L120.B0"' },
  { label: "VP9", type: 'video/webm; codecs="vp9"' },
  { label: "VP9 Profile 2 (10-bit)", type: 'video/webm; codecs="vp09.02.10.10"' },
  { label: "AV1", type: 'video/mp4; codecs="av01.0.05M.08"' },
  { label: "AV1 10-bit", type: 'video/mp4; codecs="av01.0.05M.10"' },
];

const AUDIO_CODECS: Array<{ label: string; type: string }> = [
  { label: "AAC-LC", type: 'audio/mp4; codecs="mp4a.40.2"' },
  { label: "HE-AAC", type: 'audio/mp4; codecs="mp4a.40.5"' },
  { label: "MP3", type: "audio/mpeg" },
  { label: "AC-3 (Dolby Digital)", type: 'audio/mp4; codecs="ac-3"' },
  { label: "E-AC-3 (DD+)", type: 'audio/mp4; codecs="ec-3"' },
  { label: "FLAC", type: "audio/flac" },
  { label: "WAV / PCM", type: "audio/wav" },
  { label: "Opus", type: 'audio/webm; codecs="opus"' },
  { label: "Vorbis", type: 'audio/webm; codecs="vorbis"' },
];

const CONTAINERS: Array<{ label: string; type: string }> = [
  { label: "MP4", type: "video/mp4" },
  { label: "WebM", type: "video/webm" },
  { label: "HLS", type: "application/vnd.apple.mpegurl" },
  { label: "MPEG-TS", type: "video/mp2t" },
  { label: "MOV", type: "video/quicktime" },
  { label: "MKV", type: "video/x-matroska" },
];

export function detectPlaybackSupport(): PlaybackSupport {
  if (typeof document === "undefined") {
    return {
      video: [],
      audio: [],
      containers: [],
      hdr: false,
      hevc: false,
      av1: false,
      vp9: false,
      h264: false,
    };
  }
  const v = document.createElement("video");
  const a = document.createElement("audio");
  const canV = (t: string) => v.canPlayType(t) !== "";
  const canA = (t: string) => a.canPlayType(t) !== "";

  const video = VIDEO_CODECS.filter((c) => canV(c.type)).map((c) => c.label);
  const audio = AUDIO_CODECS.filter((c) => canA(c.type)).map((c) => c.label);
  const containers = CONTAINERS.filter((c) => canV(c.type)).map((c) => c.label);

  const hdr =
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(dynamic-range: high)").matches;

  return {
    video,
    audio,
    containers,
    hdr,
    h264: video.some((l) => l.startsWith("H.264")),
    hevc: video.some((l) => l.startsWith("H.265")),
    vp9: video.some((l) => l.startsWith("VP9")),
    av1: video.some((l) => l.startsWith("AV1")),
  };
}
