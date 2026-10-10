import { useQuery, useQueryClient } from "@tanstack/react-query";

export type VpnStatus = { available: boolean; connected: boolean; hasConfig: boolean; appOnly: boolean; error?: string };
export type VpnPlugin = {
  getStatus: () => Promise<VpnStatus>;
  saveConfig: (options: { config: string; appOnly: boolean }) => Promise<VpnStatus>;
  clearConfig: () => Promise<VpnStatus>;
  connect: () => Promise<VpnStatus>;
  disconnect: () => Promise<VpnStatus>;
};

let registeredVpn: VpnPlugin | undefined;

export async function vpnPlugin(): Promise<VpnPlugin | null> {
  if (typeof window === "undefined") return null;
  // Native Java registration exposes a plugin header, not necessarily a
  // window.Capacitor.Plugins entry. Register the JS proxy before calling it.
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  const legacy = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins?.["RelayVpn"] as VpnPlugin | undefined;
  if (legacy && registeredVpn) return registeredVpn;
  if (!legacy && !Capacitor.isPluginAvailable("RelayVpn")) {
    throw new Error("This Android app cannot access the built-in VPN. Install Relay Media 1.7 or newer, then close and reopen the app. If already updated, reopen it and try again.");
  }
  if (!registeredVpn) {
    const native = legacy ?? registerPlugin<VpnPlugin>("RelayVpn");
    // Capacitor proxies synthesize every property, including `then`.
    // Return a plain adapter so Promise resolution cannot call RelayVpn.then.
    registeredVpn = {
      getStatus: () => native.getStatus(),
      saveConfig: (options) => native.saveConfig(options),
      clearConfig: () => native.clearConfig(),
      connect: () => native.connect(),
      disconnect: () => native.disconnect(),
    };
  }
  return registeredVpn;
}

export function vpnErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message :
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "VPN action failed.";
  if (/permission|not granted/i.test(message)) return "VPN permission was not granted. Connect again and approve Android’s VPN request.";
  if (/no vpn config/i.test(message)) return "No WireGuard config is saved. Import your provider’s .conf file first.";
  if (/valid WireGuard|parse|invalid.*config/i.test(message)) return "The WireGuard config could not be read. Import a fresh .conf file from your VPN provider.";
  if (/resolve|unknownhost|hostname/i.test(message)) return "The VPN server address could not be reached. Check your internet connection and the Endpoint in your config.";
  if (/another|already.*vpn/i.test(message)) return "Another VPN may be active. Disconnect it and try again.";
  // Do not display key material if a provider/parser includes config text in an error.
  return message.replace(/(?:PrivateKey|PresharedKey)\s*=\s*\S+/gi, "[private key hidden]").slice(0, 500);
}

const statusKey = ["relay-vpn", "status"];
const actionErrorKey = ["relay-vpn", "action-error"];
const countryKey = ["relay-vpn", "country"];

export function useVpnStatus() {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const plugin = await vpnPlugin();
      return plugin ? plugin.getStatus() : null;
    },
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const actionError = useQuery({ queryKey: actionErrorKey, queryFn: () => "", initialData: "", enabled: false });
  const connected = !!state.data?.connected && !state.error;
  const country = useQuery({
    queryKey: countryKey,
    queryFn: async ({ signal }) => {
      // This must originate on the device, not our server, to locate its exit IP.
      // Only the country code is kept in memory; no IP or config is stored.
      const response = await fetch("https://api.country.is", { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Country lookup unavailable. The tunnel may still be connected.");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("country" in data) || typeof data.country !== "string" || !/^[A-Z]{2}$/.test(data.country)) {
        throw new Error("The exit country could not be identified.");
      }
      return new Intl.DisplayNames(["en"], { type: "region" }).of(data.country) ?? data.country;
    },
    enabled: connected,
    staleTime: 0,
    refetchInterval: 60_000,
    retry: false,
  });

  return {
    status: state.data ?? null,
    ready: !state.isPending,
    connected,
    statusError: state.error ? vpnErrorMessage(state.error) : "",
    error: actionError.data || (state.data?.error ? vpnErrorMessage(new Error(state.data.error)) : ""),
    country: connected && !country.isFetching && !country.error ? country.data : undefined,
    countryError: connected && country.error ? "Country lookup unavailable. Check your VPN’s internet connection; the tunnel may still be connected." : "",
    locating: connected && country.isFetching,
    checking: state.isFetching,
    refresh: async () => {
      const next = await state.refetch();
      if (next.data?.connected) await client.invalidateQueries({ queryKey: countryKey });
    },
    updateStatus: (status: VpnStatus) => {
      client.setQueryData(statusKey, status);
      client.setQueryData(actionErrorKey, "");
      client.removeQueries({ queryKey: countryKey });
    },
    reportError: (error: unknown) => client.setQueryData(actionErrorKey, vpnErrorMessage(error)),
  };
}