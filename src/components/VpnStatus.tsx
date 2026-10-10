import { Link } from "@tanstack/react-router";
import { Shield, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVpnStatus } from "@/lib/vpn";

export function VpnConnectionDetails() {
  const vpn = useVpnStatus();
  const label = !vpn.ready ? "Checking…" : vpn.statusError ? "Status unavailable" :
    !vpn.status ? "Android VPN unavailable" : vpn.connected ? "Connected" : "Not connected";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2" role="status">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${!vpn.ready || !vpn.status || vpn.statusError ? "bg-muted-foreground" : vpn.connected ? "bg-vpn-connected" : "bg-vpn-disconnected"}`} />
          <span>{label}</span>
        </p>
        <Button variant="ghost" size="icon" aria-label="Refresh VPN status" disabled={vpn.checking} onClick={() => void vpn.refresh()}>
          <RefreshCw className={`size-4 ${vpn.checking ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {vpn.connected && (
        <dl className="space-y-2">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Exit country</dt><dd>{vpn.locating ? "Checking…" : vpn.country ?? "Unknown"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">VPN scope</dt><dd>{vpn.status?.appOnly ? "Relay Media only" : "Device config rules"}</dd></div>
        </dl>
      )}
      {!vpn.status && vpn.ready && !vpn.statusError && <p className="text-muted-foreground">WireGuard status is available in the Relay Media Android app, version 1.7 or newer.</p>}
      {vpn.status && !vpn.status.hasConfig && <p className="text-muted-foreground">No WireGuard config saved.</p>}
      {(vpn.statusError || vpn.error) && <p role="alert" className="break-words text-destructive">{vpn.statusError || vpn.error}</p>}
      {vpn.countryError && <p className="text-muted-foreground">{vpn.countryError}</p>}
      {vpn.connected && <p className="text-xs text-muted-foreground">Tunnel active. Country is the approximate exit location for this app’s traffic, not a guarantee of all-device protection.</p>}
    </div>
  );
}

export function VpnHomeStatus() {
  const vpn = useVpnStatus();
  const label = !vpn.ready ? "VPN checking" : vpn.statusError ? "VPN status unavailable" :
    !vpn.status ? "VPN unavailable" : vpn.connected ? `VPN connected${vpn.country ? ` · ${vpn.country}` : ""}` : "VPN not connected";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="ml-auto min-h-11 shrink-0 gap-2 px-2" aria-label={label} title={label}>
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${!vpn.ready || !vpn.status || vpn.statusError ? "bg-muted-foreground" : vpn.connected ? "bg-vpn-connected" : "bg-vpn-disconnected"}`} />
          <Shield className="size-4" />
          <span className="hidden max-w-36 truncate sm:inline">{vpn.connected && vpn.country ? vpn.country : "VPN"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <h2 className="mb-3 font-semibold">WireGuard VPN</h2>
        <VpnConnectionDetails />
        <Button variant="outline" className="mt-4 w-full" asChild>
          <Link to="/settings" search={{ section: "integrations" }}>VPN settings</Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}