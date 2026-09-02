import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEY = "media:discord-invite";
const DEFAULT_INVITE = "";

function normalize(url: string) {
  const v = url.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(discord\.gg|discord\.com)/i.test(v)) return `https://${v}`;
  return `https://discord.gg/${v.replace(/^\/+/, "")}`;
}

/** Community panel: join the Discord server, or save your own invite link. */
export function DiscordPanel() {
  const [invite, setInvite] = useState(DEFAULT_INVITE);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(KEY) ?? DEFAULT_INVITE;
    setInvite(saved);
    setDraft(saved);
  }, []);

  function save() {
    const next = normalize(draft);
    if (draft.trim() && !next.includes("discord")) {
      toast.error("That doesn't look like a Discord invite.");
      return;
    }
    setInvite(next);
    setDraft(next);
    localStorage.setItem(KEY, next);
    toast.success(next ? "Discord invite saved." : "Discord invite cleared.");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite);
      toast.success("Invite copied.");
    } catch {
      toast.error("Couldn't copy the invite.");
    }
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Discord community</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Chat with other viewers, share what you're watching and get help. Paste your
        server's invite link once and it stays on this device.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild disabled={!invite}>
          <a
            href={invite || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!invite) {
                e.preventDefault();
                toast.error("Add an invite link first.");
              }
            }}
          >
            Open Discord
          </a>
        </Button>
        <Button variant="outline" onClick={copy} disabled={!invite}>
          Copy invite
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://discord.gg/your-invite"
          aria-label="Discord invite link"
        />
        <Button variant="secondary" onClick={save}>
          Save
        </Button>
      </div>
    </section>
  );
}
