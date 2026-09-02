import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listDevices, revokeDevice } from "@/lib/devices.functions";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function DevicesPanel() {
  const { user } = useAuth();
  const list = useServerFn(listDevices);
  const revoke = useServerFn(revokeDevice);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["devices", user?.id ?? "anon"],
    queryFn: () => list({}),
    enabled: Boolean(user),
  });

  const devices = data?.devices ?? [];

  async function onRevoke(id: string) {
    const res = await revoke({ data: { deviceId: id } });
    if (res.ok) {
      toast.success("Device removed");
      await refetch();
    } else {
      toast.error("Could not remove that device");
    }
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-base font-semibold">Your devices</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Devices signed in to your account. Remove any you no longer use.
      </p>

      {!user ? (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link to="/auth" className="underline">
            Sign in
          </Link>{" "}
          to manage devices on your account.
        </p>
      ) : (
        <>
          {isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : devices.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No devices registered yet — connecting a media server while signed in
              registers this device.
            </p>
          ) : (
            <ul className="mt-4 divide-y">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {d.label}
                      {d.isCurrent && (
                        <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Last used {when(d.lastSeenAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onRevoke(d.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

        </>
      )}
    </section>
  );
}
