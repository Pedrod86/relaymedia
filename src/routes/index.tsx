import { createFileRoute, redirect } from "@tanstack/react-router";
import { listMediaServers } from "@/lib/servers.functions";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Relay Media — Your Streaming Home" },
    { name: "description", content: "Open your Relay Media library to watch movies, shows and live TV from your connected services." },
    { property: "og:title", content: "Relay Media — Your Streaming Home" },
    { property: "og:description", content: "Open your Relay Media library to watch movies, shows and live TV from your connected services." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: async () => {
    // The connected-server list lives in an encrypted httpOnly cookie, so this
    // works on the server too — no blank first render.
    let hasServer = false;
    try {
      const { servers } = await listMediaServers({});
      hasServer = servers.length > 0;
    } catch {
      hasServer = false;
    }
    throw redirect({ to: hasServer ? "/library" : "/login" });
  },
  component: () => null,
});
