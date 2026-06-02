import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // On the server we can't read localStorage, so default to /login.
    // The client component below re-checks and redirects to /library
    // if a server has already been configured.
    if (typeof window === "undefined") {
      throw redirect({ to: "/login" });
    }
    const servers = localStorage.getItem("media_servers_v1");
    const legacy = localStorage.getItem("emby_session_v1");
    const has =
      (servers && (() => { try { return JSON.parse(servers).length > 0; } catch { return false; } })()) ||
      !!legacy;
    throw redirect({ to: has ? "/library" : "/login" });
  },
  component: IndexFallback,
});

function IndexFallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const servers = localStorage.getItem("media_servers_v1");
    const legacy = localStorage.getItem("emby_session_v1");
    let has = !!legacy;
    if (!has && servers) {
      try { has = JSON.parse(servers).length > 0; } catch { /* ignore */ }
    }
    navigate({ to: has ? "/library" : "/login", replace: true });
  }, [navigate]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <p className="text-sm text-muted-foreground">Opening media library…</p>
    </main>
  );
}
