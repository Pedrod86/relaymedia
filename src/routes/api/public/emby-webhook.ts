import { createFileRoute } from "@tanstack/react-router";

/**
 * Public webhook endpoint that Emby posts to.
 *
 * Setup in Emby:
 *   Server Dashboard → Notifications → Webhooks → Add Webhook
 *   URL: https://<your-domain>/api/public/emby-webhook?token=<EMBY_WEBHOOK_SECRET>
 *   Request content type: application/json
 *   Select events you want to forward (e.g. New Media Added, Playback Start, etc.)
 *
 * The endpoint validates the shared secret, then forwards a formatted
 * message to the configured Discord webhook.
 */

type EmbyItem = {
  Name?: string;
  Type?: string;
  SeriesName?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
};

type EmbyPayload = {
  Event?: string;
  Title?: string;
  Description?: string;
  Item?: EmbyItem;
  User?: { Name?: string };
  Server?: { Name?: string };
};

function formatItem(item?: EmbyItem): string {
  if (!item) return "";
  if (item.Type === "Episode" && item.SeriesName) {
    const s = item.ParentIndexNumber?.toString().padStart(2, "0");
    const e = item.IndexNumber?.toString().padStart(2, "0");
    return `${item.SeriesName} — S${s}E${e} — ${item.Name ?? ""}`.trim();
  }
  const year = item.ProductionYear ? ` (${item.ProductionYear})` : "";
  return `${item.Name ?? "Unknown"}${year}`;
}

function buildDiscordContent(payload: EmbyPayload): string {
  const event = payload.Event ?? "emby.event";
  const server = payload.Server?.Name ?? "Emby";
  const user = payload.User?.Name ? ` · ${payload.User.Name}` : "";
  const item = formatItem(payload.Item);
  const title = payload.Title ?? event;
  const desc = payload.Description ?? "";

  const lines = [
    `**[${server}]** ${title}${user}`,
    item ? `🎬 ${item}` : "",
    desc,
  ].filter(Boolean);

  return lines.join("\n").slice(0, 1900);
}

async function parseBody(request: Request): Promise<EmbyPayload> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await request.json()) as EmbyPayload;
  }
  // Emby sometimes posts multipart/form-data with a "data" JSON field
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const data = form.get("data");
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as EmbyPayload;
      } catch {
        return { Description: data };
      }
    }
  }
  const text = await request.text();
  try {
    return JSON.parse(text) as EmbyPayload;
  } catch {
    return { Description: text };
  }
}

export const Route = createFileRoute("/api/public/emby-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.EMBY_WEBHOOK_SECRET;
        const discordUrl = process.env.EMBY_DISCORD_WEBHOOK_URL;

        if (!secret || !discordUrl) {
          return new Response("Webhook not configured", { status: 503 });
        }

        const url = new URL(request.url);
        const provided =
          url.searchParams.get("token") ??
          request.headers.get("x-webhook-token") ??
          "";

        if (provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: EmbyPayload;
        try {
          payload = await parseBody(request);
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        const content = buildDiscordContent(payload);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(discordUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: payload.Server?.Name ?? "Emby",
              content,
            }),
            signal: controller.signal,
          });
          if (!res.ok && res.status !== 204) {
            const text = await res.text().catch(() => "");
            console.error("Discord webhook failed:", res.status, text);
            return new Response("Forwarding failed", { status: 502 });
          }
        } catch (err) {
          console.error("Discord webhook error:", err);
          return new Response("Forwarding error", { status: 502 });
        } finally {
          clearTimeout(timeout);
        }

        return new Response("ok", { status: 200 });
      },
      GET: async () => {
        // Simple health probe so you can verify the URL in a browser.
        return new Response("Emby webhook endpoint is live. POST events here.", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
  },
});
