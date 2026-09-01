import { useMemo, useState } from "react";
import { imageCandidates, type MediaServer } from "@/lib/media-client";

/**
 * Artwork with automatic fallback. Servers expose artwork inconsistently between
 * endpoints (posters here, thumbs there, sometimes no image tags at all), so we
 * walk every plausible URL before showing the title-only placeholder.
 */
export function MediaImage({
  server,
  item,
  type = "Primary",
  maxWidth,
  alt,
  className,
  fallback,
}: {
  server: MediaServer;
  item: any;
  type?: "Primary" | "Thumb" | "Backdrop";
  maxWidth?: number;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const candidates = useMemo(
    () => imageCandidates(server, item, type, { maxWidth }),
    [server, item, type, maxWidth],
  );
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  if (!src) return <>{fallback ?? null}</>;

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
