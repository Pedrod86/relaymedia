// Server-only IPTV helpers.
//
// Two ways to connect an IPTV provider:
//   • Xtream Codes  — base URL + username + password (player_api.php)
//   • M3U playlist  — a single playlist URL (optionally with EPG)
//
// Credentials live in the same encrypted httpOnly cookie vault as the media
// servers, so the browser never sees the username/password or the raw playlist
// URL. Playback URLs handed to the page are sealed (AES-GCM) tokens that only
// this server can open, which keeps /api/public/iptv-stream from becoming an
// open proxy.
import type { MediaCredential } from "./vault.server";
import { normalizeUrl, sealJson, openJson } from "./vault.server";
import { assertSafeServerUrl } from "./media.server";

export type IptvChannel = {
  /** Stable-ish id — xtream stream id, or a hash of the playlist entry. */
  id: string;
  name: string;
  group: string;
  logo: string | null;
  /** Sealed playback token — pass to /api/public/iptv-stream?t=… */
  play: string;
  kind: "live" | "movie";
  /** XMLTV channel id, when the provider gives one. */
  epgId: string | null;
};

/** One guide entry. Times are epoch milliseconds. */
export type IptvProgramme = {
  start: number;
  stop: number;
  title: string;
  desc: string | null;
};


const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export function iptvMode(cred: MediaCredential): "xtream" | "m3u" {
  return cred.mode === "m3u" ? "m3u" : "xtream";
}

async function getText(url: string, signal?: AbortSignal) {
  assertSafeServerUrl(url);
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "*/*" },
    redirect: "follow",
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`Provider request failed (${res.status}).`);
  return res.text();
}

// ── Sealed playback tokens ────────────────────────────────────────────────

export function sealStreamUrl(url: string, headers?: Record<string, string>) {
  return sealJson({ u: url, h: headers ?? null, t: Date.now() });
}

export async function openStreamUrl(
  token: string,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const payload = await openJson<{ u: string; h: Record<string, string> | null }>(token);
  if (!payload?.u) return null;
  try {
    assertSafeServerUrl(payload.u);
  } catch {
    return null;
  }
  return { url: payload.u, headers: payload.h ?? {} };
}

// ── Xtream Codes ──────────────────────────────────────────────────────────

function xtreamApiUrl(cred: MediaCredential, action?: string, extra?: Record<string, string>) {
  const u = new URL(`${normalizeUrl(cred.serverUrl)}/player_api.php`);
  u.searchParams.set("username", cred.userName);
  u.searchParams.set("password", cred.token);
  if (action) u.searchParams.set("action", action);
  for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

async function xtreamJson(cred: MediaCredential, action?: string, extra?: Record<string, string>) {
  const text = await getText(xtreamApiUrl(cred, action, extra));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The provider did not return a valid Xtream response.");
  }
}

/** Validate an Xtream account and return the account/server info. */
export async function xtreamAuth(serverUrl: string, username: string, password: string) {
  const base = normalizeUrl(serverUrl);
  const fake = {
    id: "probe",
    kind: "iptv" as const,
    name: "probe",
    serverUrl: base,
    token: password,
    userId: username,
    userName: username,
  } satisfies MediaCredential;
  const info = await xtreamJson(fake);
  const auth = info?.user_info?.auth;
  const status = String(info?.user_info?.status ?? "").toLowerCase();
  if (!info?.user_info || auth === 0 || auth === "0") {
    throw new Error("Those Xtream details were rejected. Check the username and password.");
  }
  if (status && status !== "active") {
    throw new Error(`This Xtream account is ${status}.`);
  }
  return {
    userName: String(info.user_info.username ?? username),
    expires: info.user_info.exp_date ? Number(info.user_info.exp_date) : null,
    maxConnections: info.user_info.max_connections ?? null,
    serverName: String(info?.server_info?.url ?? base),
  };
}

async function xtreamChannels(cred: MediaCredential): Promise<IptvChannel[]> {
  const base = normalizeUrl(cred.serverUrl);
  const user = encodeURIComponent(cred.userName);
  const pass = encodeURIComponent(cred.token);

  const [liveCats, live, vodCats, vod] = await Promise.all([
    xtreamJson(cred, "get_live_categories").catch(() => []),
    xtreamJson(cred, "get_live_streams").catch(() => []),
    xtreamJson(cred, "get_vod_categories").catch(() => []),
    xtreamJson(cred, "get_vod_streams").catch(() => []),
  ]);

  const catName = (list: any): Map<string, string> =>
    new Map(
      (Array.isArray(list) ? list : []).map((c: any) => [
        String(c.category_id),
        String(c.category_name ?? "Uncategorised"),
      ]),
    );
  const liveNames = catName(liveCats);
  const vodNames = catName(vodCats);

  const out: IptvChannel[] = [];

  for (const s of Array.isArray(live) ? live : []) {
    const id = String(s.stream_id ?? "");
    if (!id) continue;
    out.push({
      id: `live-${id}`,
      name: String(s.name ?? `Channel ${id}`),
      group: liveNames.get(String(s.category_id)) ?? "Live TV",
      logo: s.stream_icon ? String(s.stream_icon) : null,
      kind: "live",
      epgId: s.epg_channel_id ? String(s.epg_channel_id) : null,
      play: await sealStreamUrl(`${base}/live/${user}/${pass}/${id}.m3u8`),
    });
  }

  for (const s of Array.isArray(vod) ? vod : []) {
    const id = String(s.stream_id ?? "");
    if (!id) continue;
    const ext = String(s.container_extension ?? "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
    out.push({
      id: `movie-${id}`,
      name: String(s.name ?? `Movie ${id}`),
      group: vodNames.get(String(s.category_id)) ?? "Movies",
      logo: s.stream_icon ? String(s.stream_icon) : s.cover ? String(s.cover) : null,
      kind: "movie",
      epgId: null,
      play: await sealStreamUrl(`${base}/movie/${user}/${pass}/${id}.${ext}`),
    });
  }

  return out;
}

// ── M3U playlists ─────────────────────────────────────────────────────────

function attr(line: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(line);
  return m?.[1] ? m[1] : null;
}

/** Parse an M3U/M3U8 playlist into channels. */
export async function parseM3u(text: string, limit = 6000): Promise<IptvChannel[]> {
  const lines = text.split(/\r?\n/);
  const out: IptvChannel[] = [];
  let pending: { name: string; group: string; logo: string | null; epgId: string | null } | null =
    null;
  let n = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const name = line.split(",").slice(1).join(",").trim();
      pending = {
        name: name || attr(line, "tvg-name") || "Channel",
        group: attr(line, "group-title") || "Playlist",
        logo: attr(line, "tvg-logo"),
        epgId: attr(line, "tvg-id"),
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!/^https?:\/\//i.test(line)) {
      pending = null;
      continue;
    }
    const meta = pending ?? { name: "Channel", group: "Playlist", logo: null, epgId: null };
    pending = null;
    const isMovie = /\/movie\/|\.(mp4|mkv|avi)(\?|$)/i.test(line);
    out.push({
      id: `m3u-${n}`,
      name: meta.name,
      group: meta.group,
      logo: meta.logo,
      kind: isMovie ? "movie" : "live",
      epgId: meta.epgId,
      play: await sealStreamUrl(line),
    });
    n++;
    if (n >= limit) break;
  }
  return out;
}

/** The `url-tvg`/`x-tvg-url` guide link some playlists advertise on #EXTM3U. */
export function m3uEpgUrl(text: string): string | null {
  const head = text.slice(0, 4000);
  const m = /#EXTM3U[^\n]*/i.exec(head)?.[0];
  if (!m) return null;
  const found = attr(m, "url-tvg") || attr(m, "x-tvg-url");
  const first = found?.split(",")[0]?.trim();
  return first && /^https?:\/\//i.test(first) ? first : null;
}

export async function m3uChannels(cred: MediaCredential): Promise<IptvChannel[]> {
  const text = await getText(cred.serverUrl);
  if (!/#EXTM3U/i.test(text.slice(0, 2000)) && !/^https?:\/\//im.test(text)) {
    throw new Error("That URL did not return an M3U playlist.");
  }
  return parseM3u(text);
}

/** Validate an M3U URL up front so the user gets an error at connect time. */
export async function m3uProbe(url: string) {
  const text = await getText(url);
  if (!/#EXTM3U/i.test(text.slice(0, 2000)) && !/^https?:\/\//im.test(text)) {
    throw new Error("That URL did not return an M3U playlist.");
  }
  const channels = await parseM3u(text);
  if (!channels.length) throw new Error("That playlist contains no channels.");
  return { count: channels.length, epgUrl: m3uEpgUrl(text) };
}

export async function loadChannels(cred: MediaCredential): Promise<IptvChannel[]> {
  return iptvMode(cred) === "m3u" ? m3uChannels(cred) : xtreamChannels(cred);
}

// ── EPG (XMLTV) ───────────────────────────────────────────────────────────

/** Where the guide lives for this provider. */
export function epgUrlFor(cred: MediaCredential): string | null {
  if (cred.epgUrl) return cred.epgUrl;
  if (iptvMode(cred) === "xtream") {
    const u = new URL(`${normalizeUrl(cred.serverUrl)}/xmltv.php`);
    u.searchParams.set("username", cred.userName || cred.userId);
    u.searchParams.set("password", cred.token);
    return u.toString();
  }
  return null;
}

/** XMLTV timestamps: `20260906140000 +0100` (offset optional). */
function xmltvTime(value: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, off] = m;
  const base = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, s ? +s : 0);
  if (!off) return base;
  const sign = off.startsWith("-") ? -1 : 1;
  const mins = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
  return base - mins * 60_000;
}

function unescapeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tagText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m?.[1] ? unescapeXml(m[1]) : null;
}

/**
 * Parse XMLTV into a per-channel programme map, keeping only a window around
 * now so a multi-megabyte guide stays small enough to send to the page.
 */
export function parseXmltv(
  text: string,
  opts?: { now?: number; pastMs?: number; futureMs?: number; perChannel?: number },
): Record<string, IptvProgramme[]> {
  const now = opts?.now ?? Date.now();
  const from = now - (opts?.pastMs ?? 2 * 60 * 60_000);
  const to = now + (opts?.futureMs ?? 12 * 60 * 60_000);
  const perChannel = opts?.perChannel ?? 16;

  const out: Record<string, IptvProgramme[]> = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const channel = attr(attrs, "channel");
    const start = xmltvTime(attr(attrs, "start") ?? "");
    const stop = xmltvTime(attr(attrs, "stop") ?? "");
    if (!channel || start === null) continue;
    const end = stop ?? start + 30 * 60_000;
    if (end < from || start > to) continue;
    const list = (out[channel] ??= []);
    if (list.length >= perChannel) continue;
    list.push({
      start,
      stop: end,
      title: tagText(body, "title") ?? "Programme",
      desc: tagText(body, "desc"),
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
  return out;
}

/** Download and parse the provider's guide. Returns `{}` when unavailable. */
export async function loadEpg(cred: MediaCredential): Promise<Record<string, IptvProgramme[]>> {
  const url = epgUrlFor(cred);
  if (!url) return {};
  const text = await getText(url);
  if (!/<tv[\s>]/i.test(text.slice(0, 4000))) return {};
  return parseXmltv(text);
}

