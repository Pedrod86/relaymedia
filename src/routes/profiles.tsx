import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Plus, Trash2, Baby } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activeProfileId,
  DEFAULT_PROFILE,
  loadProfiles,
  onProfileChange,
  saveProfiles,
  setActiveProfile,
  type Profile,
} from "@/lib/profiles";

export const Route = createFileRoute("/profiles")({
  head: () => ({
    meta: [
      { title: "Who's watching? — Relay Media" },
      { name: "description", content: "Switch between family profiles, each with its own history, favourites and kids mode." },
      { property: "og:title", content: "Who's watching? — Relay Media" },
      { property: "og:description", content: "Switch between family profiles, each with its own history, favourites and kids mode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilesPage,
});

const COLORS = ["#22d3ee", "#f472b6", "#a78bfa", "#facc15", "#34d399", "#fb923c"];

function ProfilesPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const [activeId, setActiveId] = useState(DEFAULT_PROFILE.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [kids, setKids] = useState(false);
  const [pin, setPin] = useState("");
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pinTry, setPinTry] = useState("");
  const [pinErr, setPinErr] = useState(false);

  useEffect(() => {
    const sync = () => {
      setProfiles(loadProfiles());
      setActiveId(activeProfileId());
    };
    sync();
    return onProfileChange(sync);
  }, []);

  const choose = (p: Profile) => {
    if (p.pin && p.id !== activeId) {
      setPinFor(p);
      setPinTry("");
      setPinErr(false);
      return;
    }
    setActiveProfile(p.id);
    navigate({ to: "/library" });
  };

  const add = () => {
    const n = name.trim().slice(0, 24);
    if (!n) return;
    const p: Profile = {
      id: Math.random().toString(36).slice(2, 10),
      name: n,
      kids,
      color: COLORS[profiles.length % COLORS.length],
      pin: /^\d{4}$/.test(pin) ? pin : undefined,
    };
    saveProfiles([...profiles, p]);
    setName("");
    setKids(false);
    setPin("");
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Who's watching?</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Manage"}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/library">Back</Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
          {profiles.map((p) => (
            <div key={p.id} className="relative">
              <button
                type="button"
                data-tv-card
                onClick={() => choose(p)}
                className={`tv-card flex w-full flex-col items-center gap-3 rounded-2xl border bg-card p-5 outline-none focus-visible:ring-4 focus-visible:ring-ring ${
                  p.id === activeId ? "ring-2 ring-primary" : ""
                }`}
              >
                <span
                  className="flex size-20 items-center justify-center rounded-2xl text-3xl font-bold text-background"
                  style={{ background: p.color }}
                >
                  {p.kids ? <Baby className="size-9" /> : p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex items-center gap-1 font-medium">
                  {p.name}
                  {p.pin && <Lock className="size-3.5 opacity-70" />}
                </span>
                {p.kids && <span className="text-xs text-muted-foreground">Kids</span>}
              </button>
              {editing && p.id !== DEFAULT_PROFILE.id && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -top-2 -right-2 size-8 rounded-full"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => {
                    saveProfiles(profiles.filter((x) => x.id !== p.id));
                    if (p.id === activeId) setActiveProfile(DEFAULT_PROFILE.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {editing && (
          <div className="mt-10 space-y-3 rounded-2xl border bg-card p-5">
            <h2 className="font-semibold">Add a profile</h2>
            <Input placeholder="Name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder="Optional 4-digit PIN"
              inputMode="numeric"
              value={pin}
              maxLength={4}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} />
              Kids profile (hides Live TV, TorBox and mature ratings)
            </label>
            <Button onClick={add} className="gap-2">
              <Plus className="size-4" /> Add profile
            </Button>
          </div>
        )}

        {pinFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
            <div className="w-80 space-y-3 rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Enter PIN for {pinFor.name}</h2>
              <Input
                autoFocus
                inputMode="numeric"
                type="password"
                maxLength={4}
                value={pinTry}
                onChange={(e) => {
                  setPinErr(false);
                  setPinTry(e.target.value.replace(/\D/g, ""));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (document.getElementById("pin-ok") as HTMLButtonElement)?.click();
                }}
              />
              {pinErr && <p className="text-sm text-destructive">Wrong PIN.</p>}
              <div className="flex gap-2">
                <Button
                  id="pin-ok"
                  onClick={() => {
                    if (pinTry !== pinFor.pin) return setPinErr(true);
                    setActiveProfile(pinFor.id);
                    setPinFor(null);
                    navigate({ to: "/library" });
                  }}
                >
                  Unlock
                </Button>
                <Button variant="ghost" onClick={() => setPinFor(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
