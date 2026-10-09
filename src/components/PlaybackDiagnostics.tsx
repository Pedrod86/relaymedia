import { toast } from "sonner";
import type { CodecCap, HdrSupport, PlaybackEnv } from "@/lib/player-prefs";

export type DiagEntry = { at: number; level: "info" | "warn" | "error"; text: string };

/** Probe a stream URL and describe what the server actually answered. */
export async function probeStream(src: string): Promise<string> {
  try {
    const res = await fetch(src, { headers: { Range: "bytes=0-1023" }, credentials: "include" });
    const finalHost = (() => {
      try { return new URL(res.url).host; } catch { return "?"; }
    })();
    const ct = res.headers.get("content-type") ?? "unknown type";
    let body = "";
    if (!res.ok) body = (await res.text().catch(() => "")).slice(0, 240);
    else void res.body?.cancel();
    const moved = res.redirected ? ` (redirected to ${finalHost})` : "";
    return `HTTP ${res.status}${moved} · ${ct}${body ? ` · ${body}` : ""}`;
  } catch (e: any) {
    return `Request failed before a reply (${e?.message ?? "network error"}) — often a redirect to another website that blocks inspection, or the server is unreachable.`;
  }
}

export function PlaybackDiagnostics(props: {
  player: string;
  serverKind: string;
  serverHost: string;
  streamHost: string;
  mode: string | null;
  attempts: string[];
  entries: DiagEntry[];
  caps: CodecCap[];
  hdr: HdrSupport;
  env: PlaybackEnv;
  decodePref: string;
}) {
  const fmt = (track: "video" | "audio") =>
    props.caps.filter((c) => c.track === track).map((c) =>
      `${c.label}: ${c.supported ? (c.hardware ? "yes (hardware)" : "yes (software)") : "no"}`);
  const yn = (v: boolean) => (v ? "yes" : "no");
  const hdrLines = [
    `HDR display: ${yn(props.hdr.hdrDisplay)}`,
    `HDR10: ${yn(props.hdr.hdr10)}`,
    `HLG: ${yn(props.hdr.hlg)}`,
    `Dolby Vision: ${yn(props.hdr.dolbyVision)}`,
    `HEVC 10-bit: ${yn(props.hdr.hevcMain10)}`,
    `4K hardware decode: ${yn(props.hdr.uhdHardware)}`,
  ];
  const platformLines = [
    `Android app: ${yn(props.env.androidNative)}`,
    `MKV without conversion: ${yn(props.env.mkv)}`,
    `Dolby Digital / DD+ passthrough: ${yn(props.env.eac3)}`,
    `HDR10 without tone-mapping: ${yn(props.env.hdr10)}`,
    `Decoder setting: ${props.decodePref}`,
  ];
  const lastError = [...props.entries].reverse().find((e) => e.level === "error");
  const report = [
    `Player: ${props.player}`,
    `Server: ${props.serverKind} @ ${props.serverHost}`,
    `Stream host: ${props.streamHost}`,
    `Current method: ${props.mode ?? "—"}`,
    `Attempts: ${props.attempts.join(" → ") || "—"}`,
    `Failure: ${lastError?.text ?? "none"}`,
    "",
    "Video codecs:", ...fmt("video"),
    "Audio codecs:", ...fmt("audio"),
    "HDR:", ...hdrLines,
    "Platform:", ...platformLines,
    "",
    ...props.entries.map((e) => `${new Date(e.at).toLocaleTimeString()} [${e.level}] ${e.text}`),
  ].join("\n");

  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-black/85 p-4 text-xs backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Playback diagnostics</p>
        <button
          className="rounded bg-white/10 px-2 py-1 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => {
            void navigator.clipboard?.writeText(report).then(
              () => toast.success("Diagnostics copied"),
              () => toast.error("Couldn't copy"),
            );
          }}
        >
          Copy report
        </button>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-white/60">Player</dt><dd>{props.player}</dd>
        <dt className="text-white/60">Server</dt><dd>{props.serverKind} · {props.serverHost}</dd>
        <dt className="text-white/60">Stream host</dt><dd className="break-all">{props.streamHost}</dd>
        <dt className="text-white/60">Current method</dt><dd>{props.mode ?? "—"}</dd>
        <dt className="text-white/60">Attempts</dt><dd>{props.attempts.join(" → ") || "—"}</dd>
        <dt className="text-white/60">Failure reason</dt>
        <dd className={lastError ? "text-destructive" : ""}>{lastError?.text ?? "None so far"}</dd>
      </dl>
      <p className="mb-1 mt-4 font-medium">Device capabilities</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {([
          ["Video", fmt("video")],
          ["Audio", fmt("audio")],
          ["HDR", hdrLines],
          ["Platform", platformLines],
        ] as const).map(([title, lines]) => (
          <div key={title}>
            <p className="mb-1 text-white/60">{title}</p>
            <ul className="space-y-0.5">
              {lines.length === 0 && <li className="text-white/50">Still checking…</li>}
              {lines.map((l) => (
                <li key={l} className={l.endsWith(": no") ? "text-white/50" : ""}>{l}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mb-1 mt-4 font-medium">Event log</p>
      <ol className="space-y-0.5 font-mono text-[11px]">
        {props.entries.length === 0 && <li className="text-white/50">No events yet.</li>}
        {props.entries.map((e, i) => (
          <li key={i} className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-accent" : "text-white/80"}>
            {new Date(e.at).toLocaleTimeString()} {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
