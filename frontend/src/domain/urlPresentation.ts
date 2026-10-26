// How a web address reads in what people see. Presentation only: the Evidence, stored originals, redirect
// chains, investigation payloads, the Evidence Lock and source URLs keep every address exactly as it was.
// Pure: no React, no native imports, no URL parser (the same result on every platform).

/** A web address in running text: http(s):// or www., never the domain part of an email address. */
const URL_IN_TEXT = /(?<![\w@.-])(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?…]$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/;
/** Characters of path shown after the host, and of an address that can't be read as one. */
const MAX_PATH = 28;
const MAX_UNREADABLE = 40;

interface Parts { host: string; path: string; rest: boolean }

/** Host (no www., no login, no port), path and whether a query or fragment followed. Null when malformed. */
function parts(raw: string): Parts | null {
  const m = raw.match(/^(?:https?:\/\/)?([^/?#]*)([^?#]*)([?#].*)?$/i);
  if (!m) return null;
  // "https://bank.com.au@evil.example/" goes to evil.example: only what follows the last "@" is the host.
  const host = m[1].slice(m[1].lastIndexOf("@") + 1).replace(/:\d*$/, "").toLowerCase().replace(/^www\./, "");
  if (!HOST.test(host)) return null;
  return { host, path: m[2], rest: !!m[3] && m[3].length > 1 };
}

/** What can't be parsed is still shortened: no scheme, nothing after ? or #, and capped. */
function unreadable(raw: string): string {
  const bare = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[?#]/)[0];
  return bare.length > MAX_UNREADABLE ? `${bare.slice(0, MAX_UNREADABLE - 1)}…` : bare || "a web address";
}

/** A path segment a person can read: short, plain, not an ID, not an address inside the address. */
function readable(segment: string): boolean {
  return segment.length <= 24 && !/[%:=&@]/.test(segment) && !/^[0-9a-f-]{16,}$/i.test(segment);
}

function decoded(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}

/** The address as a person reads it: the host plus a short readable path; "…" marks anything left out.
 *  "https://www.ebay.com.au/sl/sell?mkevt=1&…" → "ebay.com.au/sl/sell…". Short links stay whole. */
export function compactUrl(raw: string): string {
  const p = parts(raw);
  if (!p) return unreadable(raw);
  const segments = decoded(p.path).split("/").filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (const segment of segments) {
    if (!readable(segment) || length + segment.length + 1 > MAX_PATH) break;
    kept.push(segment);
    length += segment.length + 1;
  }
  const cut = kept.length < segments.length || p.rest;
  if (!kept.length) return cut ? `${p.host}/…` : p.host;
  return `${p.host}/${kept.join("/")}${cut ? "…" : ""}`;
}

/** Only the website: "https://www.ebay.com.au/sl/sell?…" → "ebay.com.au". */
export function displayHost(raw: string): string {
  return parts(raw)?.host ?? unreadable(raw);
}

function replaceUrls(text: string, show: (raw: string) => string): string {
  return text.replace(URL_IN_TEXT, (match) => {
    let raw = match;
    // Sentence punctuation and an unmatched closing bracket after an address belong to the sentence.
    for (;;) {
      const last = raw.slice(-1);
      const unmatched = (open: string, close: string) => last === close && raw.split(open).length < raw.split(close).length;
      if (TRAILING_PUNCTUATION.test(last) || unmatched("(", ")") || unmatched("[", "]")) raw = raw.slice(0, -1);
      else break;
    }
    if (!raw) return match;
    const shown = show(raw);
    const tail = match.slice(raw.length);
    return shown.endsWith("…") && tail.startsWith(".") ? shown + tail.slice(1) : shown + tail;
  });
}

/** Every web address in the text shortened to its website. Used where the text is capped (Home). */
export function domainOnly(text: string): string {
  return replaceUrls(text, displayHost);
}

/** Every web address in the text shortened for reading (host + short path). Used in reports. */
export function compactUrls(text: string): string {
  return replaceUrls(text, compactUrl);
}
