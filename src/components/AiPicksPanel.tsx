import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askWhatToWatch } from "@/lib/ai.functions";
import { useWatchHistory } from "@/lib/use-watch-history";

/** "What should I watch?" — AI picks based on the local watch history. */
export function AiPicksPanel({ serverId }: { serverId: string }) {
  const { history, genres } = useWatchHistory(serverId);
  const ask = useServerFn(askWhatToWatch);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setAnswer(null);
    try {
      const res = await ask({
        data: {
          question: question.trim() || undefined,
          genres,
          history: history.slice(0, 30).map((e) => ({
            name: e.name,
            year: e.year,
            type: e.type,
            progress: e.progress,
            completed: e.completed,
            genres: e.genres,
          })),
          available: [],
        },
      });
      if (res.ok) setAnswer(res.text);
      else toast.error(res.error);
    } catch (e: any) {
      toast.error(e?.message ?? "AI request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Ask AI what to watch</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Uses your watch history on this server ({history.length} title
        {history.length === 1 ? "" : "s"}
        {genres.length ? `, favourites: ${genres.join(", ")}` : ""}) to suggest what's next.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Optional: “something short and funny tonight”"
          aria-label="What are you in the mood for?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) run();
          }}
        />
        <Button onClick={run} disabled={busy}>
          {busy ? "Thinking…" : "Get picks"}
        </Button>
      </div>

      {answer && (
        <div className="mt-4 whitespace-pre-wrap rounded-md bg-muted/60 p-4 text-sm leading-relaxed text-foreground">
          {answer}
        </div>
      )}
      {!answer && history.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Watch something first for picks tuned to your taste — or just ask by mood above.
        </p>
      )}
    </section>
  );
}
