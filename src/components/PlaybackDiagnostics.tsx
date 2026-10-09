import { toast } from "sonner";

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
}) {
  const lastError = [...props.entries].reverse().find((e) => e.level === "error");
  const report = [
    `Player: ${props.player}`,
    `Server: ${props.serverKind} @ ${props.serverHost}`,
    `Stream host: ${props.streamHost}`,
    `Current method: ${props.mode ?? "—"}`,
    `Attempts: ${props.attempts.join(" → ") || "—"}`,
    `Failure: ${lastError?.text ?? "none"}`,
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
