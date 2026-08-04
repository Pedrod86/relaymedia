import { useEffect, useState } from "react";
import {
  BITRATE_OPTIONS,
  DEFAULT_PREFS,
  NO_HDR,
  RESOLUTION_OPTIONS,
  loadPlayerPrefs,
  probeCodecs,
  probeHdr,
  savePlayerPrefs,
  type CodecCap,
  type DecodeMode,
  type HdrMode,
  type HdrSupport,
  type PlaybackMode,
  type PlayerPrefs,
} from "@/lib/player-prefs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const DECODE: { id: DecodeMode; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "Use hardware when available, fall back to software." },
  { id: "hardware", label: "Hardware", desc: "Only GPU-decodable codecs; the server transcodes anything else." },
  { id: "software", label: "Software", desc: "Stick to widely-decodable codecs (H.264 / AAC). Most compatible." },
];

const PLAYBACK: { id: PlaybackMode; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "Direct play when the file is compatible, otherwise adaptive HLS." },
  { id: "hls", label: "Adaptive (HLS)", desc: "Always transcode to HLS. Best for slow connections." },
  { id: "direct", label: "Direct", desc: "Always stream the original file. Best quality, needs codec support." },
];

const HDR: { id: HdrMode; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "Pass HDR10/Dolby Vision through on HDR displays, tone-map otherwise." },
  { id: "passthrough", label: "Passthrough", desc: "Always send the original 4K HDR10 / Dolby Vision grade." },
  { id: "sdr", label: "Tone-map to SDR", desc: "Convert HDR to SDR (BT.2390) for standard displays." },
];

export function PlayerSettingsPanel() {
  const [prefs, setPrefs] = useState<PlayerPrefs>(DEFAULT_PREFS);
  const [caps, setCaps] = useState<CodecCap[] | null>(null);
  const [hdr, setHdr] = useState<HdrSupport>(NO_HDR);

  function retest() {
    void probeCodecs().then((c) => {
      setCaps(c);
      void probeHdr(c).then(setHdr);
    });
  }


  useEffect(() => {
    setPrefs(loadPlayerPrefs());
    retest();
  }, []);


  function update(patch: Partial<PlayerPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePlayerPrefs(next);
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Player</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose how video is decoded and streamed. Saved on this device and applied to every server.
      </p>

      <div className="mt-5">
        <p className="text-sm font-medium">Decoder</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {DECODE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => update({ decode: o.id })}
              className={`rounded-lg border p-3 text-left transition ${
                prefs.decode === o.id ? "border-primary ring-2 ring-primary/50" : "hover:bg-accent"
              }`}
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium">Streaming</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {PLAYBACK.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => update({ playback: o.id })}
              className={`rounded-lg border p-3 text-left transition ${
                prefs.playback === o.id ? "border-primary ring-2 ring-primary/50" : "hover:bg-accent"
              }`}
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Quality cap</span>
          <select
            value={prefs.maxBitrate}
            onChange={(e) => update({ maxBitrate: Number(e.target.value) })}
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {BITRATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-3 pt-7 text-sm">
          <Checkbox
            checked={prefs.autoSubtitles}
            onCheckedChange={(c) => update({ autoSubtitles: !!c })}
          />
          <span>
            <span className="font-medium">Subtitles on by default</span>
            <span className="block text-xs text-muted-foreground">
              Turn on the first text subtitle track automatically.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-6 rounded-lg bg-muted/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Codec support on this device</p>
          <Button size="sm" variant="outline" onClick={() => probeCodecs().then(setCaps)}>
            Re-test
          </Button>
        </div>
        {!caps && <p className="mt-2 text-xs text-muted-foreground">Testing…</p>}
        {caps && (
          <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {caps.map((c) => (
              <div key={`${c.track}-${c.name}`} className="flex items-center justify-between text-xs">
                <span className={c.supported ? "" : "text-muted-foreground line-through"}>{c.label}</span>
                <span
                  className={
                    !c.supported
                      ? "text-muted-foreground"
                      : c.hardware
                        ? "text-emerald-500"
                        : "text-amber-500"
                  }
                >
                  {!c.supported ? "unsupported" : c.hardware ? "hardware" : "software"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
