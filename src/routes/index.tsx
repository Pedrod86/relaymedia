import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const has = localStorage.getItem("emby_session_v1");
      throw redirect({ to: has ? "/library" : "/login" });
    }
  },
  component: () => null,
});
