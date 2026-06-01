import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { embyGetViews, embyGetItems, embyGetResume } from "@/lib/emby.functions";
import { loadSession, clearSession, imageUrl, loadHiddenViews, type EmbySession } from "@/lib/emby-client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — Emby" },
      { name: "description", content: "Browse your Emby library." },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<EmbySession | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      navigate({ to: "/login" });
      return;
    }
    setSession(s);
  }, [navigate]);

  if (!session) return null;
  return <LibraryContent session={session} onSignOut={() => {
    clearSession();
    navigate({ to: "/login" });
  }} />;
}

function LibraryContent({ session, onSignOut }: { session: EmbySession; onSignOut: () => void }) {
  const getViews = useServerFn(embyGetViews);
  const getResume = useServerFn(embyGetResume);
  const sessionArg = { serverUrl: session.serverUrl, token: session.token, userId: session.userId };
  const hidden = new Set(loadHiddenViews());

  const views = useQuery({
    queryKey: ["views", session.userId],
    queryFn: () => getViews({ data: sessionArg }),
  });
  const resume = useQuery({
    queryKey: ["resume", session.userId],
    queryFn: () => getResume({ data: sessionArg }),
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Emby</p>
            <h1 className="text-lg font-semibold">Hi, {session.userName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/settings">Settings</Link>
            </Button>
            <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-12">
        {resume.data && resume.data.items.length > 0 && (
          <Section title="Continue watching">
            <Row items={resume.data.items} session={session} kind="thumb" />
          </Section>
        )}

        {views.isLoading && <p className="text-muted-foreground">Loading library…</p>}
        {views.error && (
          <p className="text-destructive">Failed to load library. Check your server and try again.</p>
        )}

        {views.data?.views.filter((v) => !hidden.has(v.Id)).map((v) => (
          <LibrarySection key={v.Id} view={v} session={session} />
        ))}
      </div>
    </main>
  );
}

function LibrarySection({
  view,
  session,
}: {
  view: { Id: string; Name: string; CollectionType?: string };
  session: EmbySession;
}) {
  const getItems = useServerFn(embyGetItems);
  const sessionArg = { serverUrl: session.serverUrl, token: session.token, userId: session.userId };
  const q = useQuery({
    queryKey: ["items", view.Id],
    queryFn: () =>
      getItems({
        data: {
          ...sessionArg,
          parentId: view.Id,
          limit: 30,
          sortBy: "DateCreated,SortName",
        },
      }),
  });
  if (!q.data || q.data.items.length === 0) return null;
  return (
    <Section title={view.Name}>
      <Row items={q.data.items} session={session} kind="primary" />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  items,
  session,
  kind,
}: {
  items: any[];
  session: EmbySession;
  kind: "primary" | "thumb";
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
      {items.map((it) => {
        const portrait = kind === "primary";
        const imgType = kind === "thumb" ? "Thumb" : "Primary";
        const tag = it.ImageTags?.[imgType];
        return (
          <Link
            key={it.Id}
            to="/item/$id"
            params={{ id: it.Id }}
            className="group flex-shrink-0"
            style={{ width: portrait ? 160 : 280 }}
          >
            <div
              className="overflow-hidden rounded-lg bg-muted ring-1 ring-border transition group-hover:ring-primary"
              style={{ aspectRatio: portrait ? "2/3" : "16/9" }}
            >
              {tag ? (
                <img
                  src={imageUrl(session, it.Id, imgType, { maxWidth: 400, tag })}
                  alt={it.Name}
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  {it.Name}
                </div>
              )}
            </div>
            <p className="mt-2 line-clamp-1 text-sm font-medium">{it.Name}</p>
            {it.ProductionYear && (
              <p className="text-xs text-muted-foreground">{it.ProductionYear}</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
