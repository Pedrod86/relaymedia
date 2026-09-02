import { createFileRoute } from "@tanstack/react-router";
import { handlePlay, playPreflight } from "@/lib/play-endpoint.server";

export const Route = createFileRoute("/api/public/play")({
  server: {
    handlers: {
      GET: ({ request }) => handlePlay(request),
      HEAD: ({ request }) => handlePlay(request),
      OPTIONS: () => playPreflight(),
    },
  },
});
