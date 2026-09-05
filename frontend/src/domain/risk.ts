// Local, deterministic URL/domain analysis. Runs fully on-device.
// Produces plain-language signals. It never makes network calls.

import type { LocalAnalysis, RiskLevel, RiskSignal } from "./types";

const SUSPICIOUS_TLDS = new Set(["zip", "mov", "top", "xyz", "gq", "tk", "ml", "cf", "work", "click", "link", "rest", "quest", "cam", "icu", "buzz"]);
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rb.gy", "shorturl.at", "t.ly"]);
const BRANDS = ["paypal", "commbank", "netbank", "westpac", "anz", "nab", "mygov", "ato", "auspost", "australia post", "apple", "icloud", "microsoft", "office365", "google", "facebook", "instagram", "netflix", "amazon", "linkt", "telstra", "optus", "medicare", "centrelink", "servicesaustralia", "coles", "woolworths"];
const CRED_WORDS = ["login", "signin", "sign-in", "verify", "verification", "secure", "account", "update", "confirm", "password", "unlock", "suspended", "wallet", "billing", "invoice", "prize", "reward"];
const KNOWN_TEST_HOSTS = new Set(["testsafebrowsing.appspot.com", "malware.testing.google.test", "phishing.apollo.test", "malware.apollo.test"]);

export function normalizeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function levelFor(score: number): RiskLevel {
  if (score >= 70) return "malicious";
  if (score >= 40) return "suspicious";
  if (score >= 15) return "uncertain";
  return "clean";
}

export function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLevel = new Set(["com", "net", "org", "gov", "edu", "co", "ac"]);
  if (parts.length >= 3 && secondLevel.has(parts[parts.length - 2])) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export function analyseUrlLocally(raw: string): LocalAnalysis {
  const normalizedUrl = normalizeInput(raw);
  if (!normalizedUrl) {
    return { input: raw, normalizedUrl: null, host: null, valid: false, score: 0, level: "clean", signals: [] };
  }
  const u = new URL(normalizedUrl);
  const host = u.hostname.toLowerCase();
  const signals: RiskSignal[] = [];
  const add = (code: string, weight: number, plain: string) => signals.push({ code, weight, plain });

  const hostLower = host;
  const path = (u.pathname + u.search).toLowerCase();
  const regDomain = registrableDomain(hostLower);
  const tld = hostLower.split(".").pop() ?? "";
  const labels = hostLower.split(".");

  if (KNOWN_TEST_HOSTS.has(hostLower)) add("known_test_threat", 75, "This address is a known threat test page.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostLower) || hostLower.startsWith("[")) add("ip_host", 35, "The link points to a bare network address instead of a named website.");
  if (u.username || u.password) add("credentials_in_url", 45, "The link hides a username before the real address — a common disguise trick.");
  if (hostLower.includes("xn--")) add("punycode", 30, "The address uses special characters that can imitate a familiar name.");
  if (u.protocol === "http:") add("insecure_scheme", 12, "The connection is not encrypted (http, not https).");
  if (u.port && !["80", "443", ""].includes(u.port)) add("unusual_port", 15, "The link uses an unusual connection port.");
  if (SUSPICIOUS_TLDS.has(tld)) add("risky_tld", 15, `Websites ending in .${tld} are frequently used for scams.`);
  if (SHORTENERS.has(regDomain)) add("shortener", 20, "This is a shortened link, so the real destination is hidden.");
  if (labels.length >= 5) add("deep_subdomains", 15, "The address has many nested parts, which is unusual for legitimate sites.");
  if (hostLower.length > 45) add("long_host", 10, "The web address is unusually long.");
  if ((hostLower.match(/-/g) ?? []).length >= 3) add("many_hyphens", 12, "The address contains many hyphens, often seen in look-alike domains.");
  if (/%[0-9a-f]{2}/i.test(u.hostname) || (path.match(/%[0-9a-f]{2}/gi) ?? []).length > 6) add("encoded_chars", 10, "Parts of the link are encoded, which can hide where it goes.");
  if (normalizedUrl.length > 200) add("long_url", 8, "The link is very long.");

  const brandInHost = BRANDS.find((b) => hostLower.replace(/-/g, "").includes(b.replace(/\s/g, "")));
  if (brandInHost) {
    const brandDomain = regDomain.replace(/-/g, "").startsWith(brandInHost.replace(/\s/g, ""));
    if (!brandDomain) add("brand_lookalike", 40, `The address mentions "${brandInHost}" but is not that organisation's own domain.`);
  }
  const credWord = CRED_WORDS.find((w) => hostLower.includes(w) || path.includes(w));
  if (credWord && (brandInHost || SUSPICIOUS_TLDS.has(tld) || labels.length >= 4)) add("credential_lure", 20, `Words like "${credWord}" combined with other signals suggest a login or payment lure.`);
  else if (credWord && !brandInHost) add("credential_word", 6, `The link mentions "${credWord}". On its own this is normal.`);

  const score = Math.min(100, signals.reduce((s, sig) => s + sig.weight, 0));
  return { input: raw, normalizedUrl, host: hostLower, valid: true, score, level: levelFor(score), signals };
}
