import { createFileRoute } from "@tanstack/react-router";
import { handlePlay, playPreflight } from "@/lib/play-endpoint.server";

// Stable short playback URL — e.g. https://proxy.relay-media.store/play?sid=…&item=…
export const Route = createFileRoute("/play")({
  server: {
    handlers: {
      GET: ({ request }) => handlePlay(request),
      HEAD: ({ request }) => handlePlay(request),
      OPTIONS: () => playPreflight(),
    },
  },
});
