import type { ServerKind } from "@/lib/media-client";

type Props = {
  kind: ServerKind;
  size?: number;
  className?: string;
};

/**
 * Brand glyphs for the supported media servers.
 * Simplified marks — recognisable silhouettes, no trademarked wordmarks.
 */
export function ServerIcon({ kind, size = 16, className }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
    focusable: false as const,
  };

  if (kind === "plex") {
    // Plex chevron
    return (
      <svg {...common}>
        <path d="M6 3h6l6 9-6 9H6l6-9-6-9z" fill="#e5a00d" />
      </svg>
    );
  }
  if (kind === "jellyfin") {
    // Jellyfin double-diamond
    return (
      <svg {...common}>
        <defs>
          <linearGradient id="jf-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#aa5cc3" />
            <stop offset="100%" stopColor="#00a4dc" />
          </linearGradient>
        </defs>
        <path
          d="M12 3l8 14H4L12 3zm0 5.2L7.6 15.5h8.8L12 8.2z"
          fill="url(#jf-grad)"
        />
      </svg>
    );
  }
  if (kind === "iptv") {
    // IPTV — antenna / broadcast mark
    return (
      <svg {...common}>
        <path
          d="M9 10h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"
          fill="#38bdf8"
        />
        <path
          d="M12 9L7 3M12 9l5-6"
          stroke="#38bdf8"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
  if (kind === "silo") {
    // Silo — simple cylindrical tower mark
    return (
      <svg {...common}>
        <path
          d="M6 9a6 3 0 0 1 12 0v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9z"
          fill="#94a3b8"
        />
      </svg>
    );
  }
  // Emby — green star-ish mark
  return (
    <svg {...common}>
      <path
        d="M12 2l2.8 6.1L21 9l-4.6 4.2L17.8 20 12 16.8 6.2 20l1.4-6.8L3 9l6.2-.9L12 2z"
        fill="#52b54b"
      />
    </svg>
  );
}

export function ServerLabel({
  kind,
  size = 14,
  className,
}: {
  kind: ServerKind;
  size?: number;
  className?: string;
}) {
  const name =
    kind === "emby" ? "Emby" :
    kind === "jellyfin" ? "Jellyfin" :
    kind === "silo" ? "Silo" :
    kind === "iptv" ? "IPTV" :
    "Plex";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <ServerIcon kind={kind} size={size} />
      {name}
    </span>
  );
}
