import { createFileRoute } from "@tanstack/react-router";
import { LATEST_ANDROID_RELEASE } from "@/lib/app-release";

// Update manifest polled by the Android app: GET /api/public/app-version
// Public, read-only, no PII.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

export const Route = createFileRoute("/api/public/app-version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ android: LATEST_ANDROID_RELEASE }), { headers: CORS }),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
