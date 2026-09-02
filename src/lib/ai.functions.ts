import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const titleSchema = z.object({
  name: z.string(),
  year: z.number().optional(),
  type: z.string().optional(),
  progress: z.number().optional(),
  completed: z.boolean().optional(),
  genres: z.array(z.string()).optional(),
});

/**
 * Ask Lovable AI what to watch next, using the viewer's own watch history and
 * (optionally) the titles that exist on their media server.
 */
export const askWhatToWatch = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      question: z.string().trim().max(500).optional(),
      history: z.array(titleSchema).max(40).default([]),
      genres: z.array(z.string()).max(10).default([]),
      available: z.array(z.string()).max(120).default([]),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, error: "AI is not configured." };

    const historyText = data.history.length
      ? data.history
          .map(
            (h) =>
              `- ${h.name}${h.year ? ` (${h.year})` : ""}${h.type ? ` [${h.type}]` : ""}` +
              `${h.completed ? " — finished" : h.progress ? ` — ${Math.round(h.progress)}% watched` : ""}` +
              `${h.genres?.length ? ` — ${h.genres.join(", ")}` : ""}`,
          )
          .join("\n")
      : "(no watch history yet)";

    const availableText = data.available.length
      ? `Titles available on their server (prefer these when they fit):\n${data.available.join(", ")}`
      : "";

    const prompt = [
      "Recommend what this person should watch next.",
      `Their recent viewing:\n${historyText}`,
      data.genres.length ? `Favourite genres: ${data.genres.join(", ")}` : "",
      availableText,
      data.question ? `They also asked: ${data.question}` : "",
      "Reply with 3-5 picks. For each: the title on one line, then one short sentence saying why it fits their taste. Keep the whole answer under 220 words. No markdown headings or tables.",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-3.7-flash",
          messages: [
            {
              role: "system",
              content:
                "You are a warm, concise film and TV curator inside a personal media-server app. Be specific and avoid generic blockbusters unless they truly match.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        let message = body;
        try {
          message = JSON.parse(body)?.error?.message ?? body;
        } catch {
          /* keep raw text */
        }
        if (res.status === 429) {
          return { ok: false as const, error: "Too many requests right now — try again in a moment." };
        }
        if (res.status === 402 || res.status === 403) {
          return { ok: false as const, error: message || "AI credits are unavailable." };
        }
        return { ok: false as const, error: message || `AI request failed (${res.status}).` };
      }

      const json: any = await res.json();
      const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) return { ok: false as const, error: "AI returned an empty answer." };
      return { ok: true as const, text };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "AI request failed." };
    }
  });
