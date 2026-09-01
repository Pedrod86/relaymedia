import type { PlaybackEnv, StreamCheck } from "@/lib/player-prefs";

// Read-only "what is actually happening to this stream" panel.
//
// Shows the codecs the player asked for, what the server is delivering, and
// whether MKV / E-AC3 / HDR10 were passed through untouched or converted.

type Props = {
  check: StreamCheck | null;
  /** Resolved stream mode for this playback ("direct" includes remuxes). */
  mode: "direct" | "hls" | null;
  env: PlaybackEnv;
  hdrParam: "passthrough" | "tonemap";
  /** Codec allow-lists sent to the server. */
  videoCodecs: string[];
  audioCodecs: string[];
};

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "info" }) {
  const color =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "info"
          ? "text-sky-300"
          : "text-white/80";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1 last:border-0">
      <span className="opacity-60">{label}</span>
      <span className={`text-right font-medium ${color}`}>{value}</span>
    </div>
  );
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

export function PlaybackDetails({ check, mode, env, hdrParam, videoCodecs, audioCodecs }: Props) {
  const container = check?.container?.toUpperCase();
  const isMkv = check?.container === "mkv" || check?.container === "matroska";
  const mkvPassthrough = isMkv && mode === "direct" && !check?.remux;
  const dolby = ["eac3", "ec-3", "ac3", "ac-3"].includes(check?.audioCodec ?? "");
  const hdr10 = check?.videoRange === "HDR10" || check?.videoRange === "HDR10+";

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs">
      <p className="mb-3 text-sm font-medium">Playback details</p>

      {!check && <p className="opacity-60">Reading media info…</p>}

      {check && (
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <Row
              label="Delivery"
              value={
                mode === "direct"
                  ? check.remux
                    ? "Direct (remux, stream-copy)"
                    : "Direct play"
                  : "Adaptive HLS (transcoded)"
              }
              tone={mode === "direct" ? "ok" : "warn"}
            />
            <Row label="Source container" value={container ?? "unknown"} />
            <Row
              label="Video codec"
              value={`${check.videoCodec?.toUpperCase() ?? "unknown"}${
                check.videoSupported ? (check.videoHardware ? " • hardware" : " • software") : " • unsupported"
              }`}
              tone={check.videoSupported ? (check.videoHardware ? "ok" : "warn") : "warn"}
            />
            <Row
              label="Audio codec"
              value={`${check.audioCodec?.toUpperCase() ?? "unknown"}${
                check.audioPassthrough ? " • passthrough" : " • re-encoded to AAC"
              }`}
              tone={check.audioPassthrough ? "ok" : "warn"}
            />
            <Row label="Resolution" value={`${check.resolution ?? "unknown"}${check.is4K ? " (4K)" : ""}`} />
            <Row
              label="Dynamic range"
              value={`${check.isDolbyVision ? "Dolby Vision" : check.videoRange}${
                check.isHdr ? (check.hdrPassthrough ? " • passthrough" : " • tone-mapped to SDR") : ""
              }`}
              tone={check.isHdr ? (check.hdrPassthrough ? "info" : "warn") : undefined}
            />
          </div>

          <div>
            <Row
              label="MKV passthrough"
              value={isMkv ? (mkvPassthrough ? "Yes — original container" : "No — repackaged to MP4") : "n/a (not MKV)"}
              tone={isMkv ? (mkvPassthrough ? "ok" : "warn") : undefined}
            />
            <Row
              label="E-AC3 / AC3 passthrough"
              value={dolby ? (check.audioPassthrough ? "Yes — Dolby track copied" : "No — downmixed to AAC") : "n/a (not Dolby)"}
              tone={dolby ? (check.audioPassthrough ? "ok" : "warn") : undefined}
            />
            <Row
              label="HDR10 passthrough"
              value={hdr10 ? (check.hdrPassthrough ? "Yes — PQ grade untouched" : "No — tone-mapped") : "n/a (not HDR10)"}
              tone={hdr10 ? (check.hdrPassthrough ? "ok" : "warn") : undefined}
            />
            <Row label="HDR request sent" value={hdrParam === "passthrough" ? "passthrough" : "tone-map"} />
            <Row label="Video codecs offered" value={videoCodecs.join(", ") || "—"} />
            <Row label="Audio codecs offered" value={audioCodecs.join(", ") || "—"} />
            <Row
              label="Device support"
              value={`MKV ${yesNo(env.mkv)} • E-AC3 ${yesNo(env.eac3)} • HDR10 ${yesNo(env.hdr10)}${
                env.androidNative ? " • native app" : ""
              }`}
            />
          </div>
        </div>
      )}

      {check && check.notes.length > 0 && (
        <ul className="mt-3 space-y-1 opacity-70">
          {check.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
