import { createFileRoute, redirect } from "@tanstack/react-router";
import { listMediaServers } from "@/lib/servers.functions";

export const Route = createFileRoute("/")({
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
