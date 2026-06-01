import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const servers = localStorage.getItem("media_servers_v1");
      const legacy = localStorage.getItem("emby_session_v1");
      const has = (servers && JSON.parse(servers).length > 0) || !!legacy;
      throw redirect({ to: has ? "/library" : "/login" });
    }
  },
  component: () => null,
});
