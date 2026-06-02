import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    const servers = localStorage.getItem("media_servers_v1");
    const legacy = localStorage.getItem("emby_session_v1");
    let has = !!legacy;
    if (!has && servers) {
      try {
        has = JSON.parse(servers).length > 0;
      } catch {
        /* ignore */
      }
    }
    setDecided(true);
    navigate({ to: has ? "/library" : "/login", replace: true });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          {decided ? "Redirecting…" : "Opening RelayMedia…"}
        </p>
        <noscript>
          <p className="mt-4 text-sm">
            <a href="/login" className="underline">
              Go to login
            </a>
          </p>
        </noscript>
        <meta httpEquiv="refresh" content="1;url=/login" />
      </div>
    </main>
  );
}
