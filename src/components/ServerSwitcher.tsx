import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ServerIcon } from "@/components/ServerIcon";
import type { MediaServer } from "@/lib/media-client";

/**
 * One-tap switcher between connected media servers.
 *
 * This uses a portalled dialog rather than an absolutely positioned dropdown:
 * the header sits inside clipping/transformed containers (hero, sticky bars),
 * which silently swallowed the old menu on phones and TV boxes — the tap
 * registered but nothing appeared on screen.
 */
export function ServerSwitcher({
  servers,
  active,
  onSwitch,
}: {
  servers: MediaServer[];
  active: MediaServer;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Switch server"
        className="min-h-10"
      >
        <ServerIcon kind={active.kind} size={14} />
        <span className="max-w-[6rem] truncate sm:max-w-[9rem]">{active.name}</span>
        <span aria-hidden className="opacity-60">
          ⇄
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Switch server</DialogTitle>
            <DialogDescription>
              Pick which media server to browse. Use up/down then OK on a remote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {servers.map((s, i) => {
              const isActive = s.id === active.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  /* Land the remote on the first row so OK works immediately. */
                  autoFocus={i === 0}
                  aria-current={isActive}
                  onClick={() => {
                    setOpen(false);
                    if (!isActive) onSwitch(s.id);
                  }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left outline-none transition hover:bg-accent focus:bg-accent focus:ring-2 focus:ring-ring ${
                    isActive ? "border-primary bg-accent/60" : "border-border"
                  }`}
                >
                  <ServerIcon kind={s.kind} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.userName} · {s.kind}
                    </span>
                  </span>
                  {isActive && <span className="text-primary">✓</span>}
                </button>
              );
            })}
            <Button asChild variant="outline" className="w-full focus:ring-2 focus:ring-ring">
              <Link to="/login" onClick={() => setOpen(false)}>
                + Add another server
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
