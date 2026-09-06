// Host canonicalization + event-safe URL sanitization (TypeScript reference).
// Parity vectors: security/test-vectors/normalization/{host,url}_vectors.json
// Runtime-neutral: no Node/browser URL API, works in Hermes and Node.
//
// host:  trim -> strip one trailing dot -> IPv6 literal (validated, RFC 5952
//        compressed, bracketed) | IPv4 literal | NFC lowercase + punycode labels.
//        Labels 1..63 chars, [a-z0-9-], no leading/trailing '-', total <= 253.
// url:   http/https only -> canonical host -> path.
//        sanitizedUrl = scheme://host + path (no userinfo, port, query, fragment)

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEX4_RE = /^[0-9a-fA-F]{1,4}$/;

// ---- RFC 3492 punycode (encode only) --------------------------------------
function punyDigit(d: number): string {
  return String.fromCharCode(d < 26 ? 97 + d : 22 + d);
}
function punyAdapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / 700) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > 455) {
    delta = Math.floor(delta / 35);
    k += 36;
  }
  return k + Math.floor((36 * delta) / (delta + 38));
}
export function punycodeEncode(input: string): string {
  const cps = Array.from(input, (c) => c.codePointAt(0) as number);
  let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join("");
  const basic = out.length;
  let h = basic;
  if (basic > 0) out += "-";
  let n = 128;
  let delta = 0;
  let bias = 72;
  while (h < cps.length) {
    let m = Number.MAX_SAFE_INTEGER;
    for (const c of cps) if (c >= n && c < m) m = c;
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = 36; ; k += 36) {
          const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
          if (q < t) break;
          out += punyDigit(t + ((q - t) % (36 - t)));
          q = Math.floor((q - t) / (36 - t));
        }
        out += punyDigit(q);
        bias = punyAdapt(delta, h + 1, h === basic);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

// ---- IPv6 -----------------------------------------------------------------
function parseIpv4(s: string): number[] | null {
  if (!IPV4_RE.test(s)) return null;
  return s.split(".").map((p) => parseInt(p, 10));
}
function expandGroups(parts: string[], out: number[]): boolean {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.includes(".")) {
      if (i !== parts.length - 1) return false;
      const v4 = parseIpv4(p);
      if (!v4) return false;
      out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    } else {
      if (!HEX4_RE.test(p)) return false;
      out.push(parseInt(p, 16));
    }
  }
  return true;
}
export function canonicalizeIpv6(literal: string): string | null {
  if (!/^[0-9a-fA-F:.]+$/.test(literal)) return null;
  const halves = literal.split("::");
  if (halves.length > 2) return null;
  const head: number[] = [];
  const tail: number[] = [];
  if (!expandGroups(halves[0] === "" ? [] : halves[0].split(":"), head)) return null;
  if (halves.length === 2 && !expandGroups(halves[1] === "" ? [] : halves[1].split(":"), tail)) return null;
  let groups: number[];
  if (halves.length === 2) {
    if (head.length + tail.length > 7) return null;
    groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  // RFC 5952: compress the longest run of zero groups (len >= 2), leftmost wins.
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (g: number) => g.toString(16);
  let text: string;
  if (bestLen >= 2) {
    const left = groups.slice(0, bestStart).map(hex).join(":");
    const right = groups.slice(bestStart + bestLen).map(hex).join(":");
    text = `${left}::${right}`;
  } else {
    text = groups.map(hex).join(":");
  }
  return `[${text}]`;
}

// ---- Host -----------------------------------------------------------------
export function canonicalizeHost(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let host = raw.trim();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0) return null;
  if (host.startsWith("[") && host.endsWith("]")) return canonicalizeIpv6(host.slice(1, -1));
  if (host.includes(":")) return canonicalizeIpv6(host);
  if (IPV4_RE.test(host)) return host;
  const labels = host.normalize("NFC").toLowerCase().split(".");
  const ascii: string[] = [];
  for (const label of labels) {
    if (label.length === 0) return null;
    const isAscii = /^[\x00-\x7f]*$/.test(label);
    const encoded = isAscii ? label : `xn--${punycodeEncode(label)}`;
    if (!LABEL_RE.test(encoded)) return null;
    ascii.push(encoded);
  }
  const joined = ascii.join(".");
  return joined.length > 253 ? null : joined;
}

// ---- URL ------------------------------------------------------------------
export interface ParsedCandidateUrl {
  /** Original input; may be analyzed locally, must never leave the device. */
  original: string;
  scheme: "http" | "https";
  host: string;
  path: string;
  /** scheme + canonical host + path. The only URL form allowed in shared events / cloud lookups. */
  sanitizedUrl: string;
  hadUserinfo: boolean;
  hadQuery: boolean;
  hadFragment: boolean;
}

const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

export function sanitizeUrl(raw: string): ParsedCandidateUrl | null {
  const m = URL_RE.exec(raw.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  let authority = m[2];
  const hadUserinfo = authority.includes("@");
  if (hadUserinfo) authority = authority.slice(authority.lastIndexOf("@") + 1);
  let hostPart: string;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    hostPart = authority.slice(0, end + 1);
    const rest = authority.slice(end + 1);
    if (rest !== "" && !/^:\d*$/.test(rest)) return null;
  } else {
    const colon = authority.lastIndexOf(":");
    hostPart = colon >= 0 ? authority.slice(0, colon) : authority;
    if (colon >= 0 && !/^\d*$/.test(authority.slice(colon + 1))) return null;
  }
  const host = canonicalizeHost(hostPart);
  if (!host) return null;
  const path = m[3] === "" ? "/" : m[3];
  return {
    original: raw,
    scheme,
    host,
    path,
    sanitizedUrl: `${scheme}://${host}${path}`,
    hadUserinfo,
    hadQuery: (m[4] ?? "").length > 0,
    hadFragment: (m[5] ?? "").length > 0,
  };
}
