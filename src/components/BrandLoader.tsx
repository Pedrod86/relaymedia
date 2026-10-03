import relayLogo from "@/assets/relay-logo.png.asset.json";

export function BrandLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
      <img
        src={relayLogo.url}
        alt="Relay Media"
        className="h-16 w-16 animate-pulse rounded-2xl object-contain"
      />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
