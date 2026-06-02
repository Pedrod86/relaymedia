// SSRF guard for server-side outbound fetches. Rejects URLs whose hostname
// resolves to (or literally is) a private/loopback/link-local address.
import { promises as dns } from "node:dns";
import net from "node:net";

type SsrfGuardOptions = {
  allowPrivateNetworks?: boolean;
};

function ipIsBlocked(ip: string, options: SsrfGuardOptions = {}): boolean {
  if (!ip) return true;
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (options.allowPrivateNetworks) {
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
    }
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    // IPv4-mapped (::ffff:a.b.c.d)
    const m = lower.match(/^::ffff:([0-9.]+)$/);
    if (m) return ipIsBlocked(m[1]);
    return false;
  }
  return true;
}

export async function assertSafeExternalUrl(rawUrl: string, options: SsrfGuardOptions = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("Invalid host");

  // Block obvious hostnames
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".localhost") ||
    lowerHost === "metadata.google.internal"
  ) {
    throw new Error("Target host is not allowed");
  }

  const ips: string[] = [];
  if (net.isIP(host)) {
    ips.push(host);
  } else {
    try {
      const resolved = await dns.lookup(host, { all: true });
      ips.push(...resolved.map((r) => r.address));
    } catch {
      throw new Error("Could not resolve host");
    }
  }
  for (const ip of ips) {
    if (ipIsBlocked(ip, options)) {
      throw new Error("Target resolves to a blocked network");
    }
  }
  return u;
}
