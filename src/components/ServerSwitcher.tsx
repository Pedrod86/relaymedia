import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ServerIcon } from "@/components/ServerIcon";
import type { MediaServer } from "@/lib/media-client";

/**
 * One-tap switcher between connected media servers. Works with a mouse, a
 * touch screen and a TV remote (it is a plain button + focusable list).
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
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch server"
      >
        <ServerIcon kind={active.kind} size={14} />
        <span className="max-w-[7rem] truncate">{active.name}</span>
        <span aria-hidden className="opacity-60">
          ▾
        </span>
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-xl"
        >
          <p className="px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            Your servers
          </p>
          {servers.map((s) => {
            const isActive = s.id === active.id;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onSwitch(s.id);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm outline-none transition hover:bg-accent focus-visible:bg-accent ${
                  isActive ? "bg-accent/60 font-semibold" : ""
                }`}
              >
                <ServerIcon kind={s.kind} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.userName} · {s.kind}
                  </span>
                </span>
                {isActive && <span className="text-primary">✓</span>}
              </button>
            );
          })}
          <div className="mt-1 border-t pt-1">
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
            >
              + Add another server
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
