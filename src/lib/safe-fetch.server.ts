/**
 * Ophalen van externe pagina's zonder interne netwerken te raken (SSRF).
 * - blokkeert loopback, privé, link-local, CGNAT, multicast en IPv6 ULA/link-local
 * - lost de naam op via DNS-over-HTTPS en controleert elk antwoord
 * - volgt max. 3 redirects handmatig en controleert elke nieuwe host opnieuw
 */

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4Blocked(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

export function ipBlocked(ip: string): boolean {
  return ip.includes(":") ? ipv6Blocked(ip) : ipv4Blocked(ip);
}

async function resolve(host: string, type: "A" | "AAAA"): Promise<string[]> {
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) },
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
    const want = type === "A" ? 1 : 28;
    return (j.Answer ?? []).filter((x) => x.type === want).map((x) => x.data);
  } catch {
    return [];
  }
}

export async function assertPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(local|internal|localhost|lan|home|arpa)$/.test(host))
    return false;
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return false; // decimale/hex IP-trucs
  if (/^[\d.]+$/.test(host) || host.includes(":")) return !ipBlocked(host);
  const ips = [...(await resolve(host, "A")), ...(await resolve(host, "AAAA"))];
  if (ips.length === 0) return false;
  return ips.every((ip) => !ipBlocked(ip));
}

export async function safePublicFetch(
  url: URL,
  init: { headers?: Record<string, string> } = {},
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    if (!(await assertPublicHost(current.hostname))) return null;
    const res = await fetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: init.headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current);
      continue;
    }
    return res;
  }
  return null;
}
