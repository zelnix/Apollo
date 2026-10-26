// Gate 3 — Brand & Impersonation engine + Verify Website.
// Compares what a destination *claims* to be with where it actually lives, using an independently
// maintained list of official domains (never information from the suspicious page itself).

export interface BrandRecord { name: string; tokens: string[]; official: string[] }

export const OFFICIAL_DOMAINS: BrandRecord[] = [
  { name: "CommBank", tokens: ["commbank", "commonwealthbank", "netbank"], official: ["commbank.com.au", "netbank.com.au"] },
  { name: "Westpac", tokens: ["westpac"], official: ["westpac.com.au"] },
  { name: "ANZ", tokens: ["anz"], official: ["anz.com.au", "anz.com"] },
  { name: "NAB", tokens: ["nab", "nationalaustraliabank"], official: ["nab.com.au"] },
  { name: "Macquarie", tokens: ["macquarie"], official: ["macquarie.com.au", "macquarie.com"] },
  { name: "Bendigo Bank", tokens: ["bendigobank"], official: ["bendigobank.com.au"] },
  { name: "PayPal", tokens: ["paypal"], official: ["paypal.com", "paypal.com.au"] },
  { name: "Australia Post", tokens: ["auspost", "australiapost"], official: ["auspost.com.au"] },
  { name: "Linkt", tokens: ["linkt"], official: ["linkt.com.au"] },
  { name: "myGov", tokens: ["mygov"], official: ["my.gov.au"] },
  { name: "ATO", tokens: ["ato"], official: ["ato.gov.au"] },
  { name: "Services Australia", tokens: ["centrelink", "servicesaustralia", "medicare"], official: ["servicesaustralia.gov.au", "my.gov.au"] },
  { name: "Telstra", tokens: ["telstra"], official: ["telstra.com.au", "telstra.com"] },
  { name: "Optus", tokens: ["optus"], official: ["optus.com.au"] },
  { name: "Microsoft", tokens: ["microsoft", "office365", "outlook", "onedrive"], official: ["microsoft.com", "microsoftonline.com", "live.com", "office.com", "outlook.com", "sharepoint.com"] },
  { name: "Google", tokens: ["google", "gmail"], official: ["google.com", "google.com.au", "gmail.com", "goo.gl", "youtube.com"] },
  { name: "Apple", tokens: ["apple", "icloud"], official: ["apple.com", "icloud.com"] },
  { name: "Amazon", tokens: ["amazon"], official: ["amazon.com", "amazon.com.au", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.co.jp"] },
  { name: "eBay", tokens: ["ebay"], official: ["ebay.com", "ebay.com.au", "ebay.co.uk", "ebay.ca", "ebay.de", "ebay.fr", "ebay.it", "ebay.es", "ebay.ie", "ebaystatic.com", "ebayimg.com"] },
  { name: "Netflix", tokens: ["netflix"], official: ["netflix.com"] },
  { name: "Facebook", tokens: ["facebook", "meta"], official: ["facebook.com", "fb.com", "meta.com"] },
];

/** Registrable domain (eTLD+1), with second-level country suffixes handled (commbank.com.au, ebay.co.uk, ebay.com.sg). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const secondLevel = ["com", "net", "org", "gov", "edu", "asn", "id", "co"];
  return secondLevel.includes(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
}

// Services where anyone can put any name in front of the service's own address (ebay.onelink.me).
const SHARED_SERVICES = new Set(["onelink.me", "page.link", "app.link", "web.app", "firebaseapp.com", "github.io", "gitlab.io", "netlify.app", "vercel.app",
  "pages.dev", "workers.dev", "herokuapp.com", "glitch.me", "repl.co", "wixsite.com", "weebly.com", "blogspot.com", "wordpress.com", "square.site",
  "godaddysites.com", "webflow.io", "framer.website", "carrd.co", "linktr.ee", "notion.site", "ngrok.io", "ngrok-free.app", "trycloudflare.com",
  "azurewebsites.net", "r2.dev", "surge.sh", "000webhostapp.com", "canva.site"]);
// Country endings sold to anyone as general-purpose addresses: a name on one isn't a country site.
const OPEN_COUNTRY_ENDINGS = new Set(["co", "me", "io", "tv", "cc", "ws", "tk", "ml", "ga", "cf", "gq", "ly", "to", "sh", "ai", "gg", "vc", "la", "fm", "am", "so", "su", "nu", "pw", "ac", "im", "bz", "li", "st", "sx", "cx", "cm"]);

/** Exactly a global organisation's name on a country ending (amazon.com.mx for amazon.com), as its own country
 *  sites are. Genuine for brand checks, though not on the list. */
export function isCountrySite(host: string, officialDomains: string[]): boolean {
  const reg = registrableDomain(host);
  const [label, ...rest] = reg.split(".");
  const ending = rest[0] === "com" || rest[0] === "co" ? rest.slice(1) : rest;
  const country = ending.length === 1 && /^[a-z]{2}$/.test(ending[0]) && !OPEN_COUNTRY_ENDINGS.has(ending[0]);
  return country && officialDomains.some((d) => /^[a-z0-9-]+\.com$/.test(d) && d.split(".")[0] === label);
}

/** What an address is for an organisation it mentions: one of its own (listed, or a country site), its name in
 *  front of a shared link/website service, a lookalike, or unrelated. Only a lookalike or a shared service is a
 *  warning sign: not being the main domain is not, on its own, evidence of impersonation. */
export type BrandDomainKind = "official" | "country_site" | "shared_service" | "lookalike" | "unrelated";
export function brandDomainKind(b: BrandRecord, host: string): BrandDomainKind {
  const h = host.toLowerCase().replace(/^www\./, "");
  const reg = registrableDomain(h);
  if (b.official.some((o) => reg === o || h.endsWith(`.${o}`))) return "official";
  if (isCountrySite(h, b.official)) return "country_site";
  const carries = (text: string) => b.tokens.some((t) => t.length >= 3 && (t.length >= 4 ? text.replace(/[^a-z0-9]/g, "").includes(t) : text.split(/[.-]/).includes(t)))
    || b.tokens.some((t) => t.length >= 5 && deobfuscate(text).includes(t));
  if (SHARED_SERVICES.has(reg)) return carries(h.slice(0, Math.max(0, h.length - reg.length - 1))) ? "shared_service" : "unrelated";
  return carries(h) ? "lookalike" : "unrelated";
}

/** Undo common look-alike substitutions: paypa1 → paypal, micr0soft → microsoft, rn → m, vv → w. */
export function deobfuscate(label: string): string {
  return label.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s").replace(/rn/g, "m").replace(/vv/g, "w").replace(/[^a-z]/g, "");
}

export interface BrandAssessment {
  claimed: BrandRecord | null;
  /** True when the address itself carries the brand but shows a real lookalike sign or puts the name on a shared
   *  link service. An address that merely isn't the brand's main domain is not a mismatch. */
  mismatch: boolean;
  /** True when the match only appears after undoing character substitutions (homograph/lookalike). */
  homograph: boolean;
  registrable: string;
  isOfficial: boolean;
  kind: BrandDomainKind | null;
}

export function assessBrand(host: string, hintBrand?: string | null): BrandAssessment {
  const reg = registrableDomain(host);
  const compact = host.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deob = deobfuscate(host);
  let claimed: BrandRecord | null = null; let homograph = false;
  for (const b of OFFICIAL_DOMAINS) {
    const direct = b.tokens.some((t) => t.length >= 3 && (t.length >= 4 ? compact.includes(t) : host.toLowerCase().split(/[.-]/).includes(t)));
    const fuzzy = !direct && b.tokens.some((t) => t.length >= 5 && deob.includes(t));
    if (direct || fuzzy) { claimed = b; homograph = fuzzy; break; }
  }
  if (!claimed && hintBrand) claimed = OFFICIAL_DOMAINS.find((b) => b.name.toLowerCase() === hintBrand.toLowerCase()) ?? null;
  const kind = claimed ? brandDomainKind(claimed, host) : null;
  return { claimed, mismatch: kind === "lookalike" || kind === "shared_service", homograph, registrable: reg, isOfficial: kind === "official", kind };
}

/** Verify Website: plain-language comparison for the sheet. */
export function verifyWebsite(host: string, hintBrand?: string | null): { title: string; lines: string[]; matches: boolean | null } {
  const a = assessBrand(host, hintBrand);
  if (!a.claimed) return { title: "No organisation claim to check", lines: [`Current website: ${a.registrable}`, "This address doesn't mention a known organisation, so there's nothing to compare. Judge it by what it asks you for."], matches: null };
  if (a.isOfficial) return { title: "These match", lines: [`Claimed organisation: ${a.claimed.name}`, `Current website: ${a.registrable}`, `Official ${a.claimed.name} domains include: ${a.claimed.official.join(", ")}`], matches: true };
  if (a.kind === "country_site") return { title: "These match", lines: [`Claimed organisation: ${a.claimed.name}`, `Current website: ${a.registrable} — ${a.claimed.name}'s name exactly, on a country ending, as their own country sites are`, `Official ${a.claimed.name} domains include: ${a.claimed.official.join(", ")}`], matches: true };
  return { title: "These do not match", lines: [`Claimed organisation: ${a.claimed.name}`, `Current website: ${a.registrable}${a.homograph ? " (uses look-alike characters)" : ""}`, `Official ${a.claimed.name} domains: ${a.claimed.official.join(", ")}`, "Open the organisation's official app or type its address yourself — never use details from this page."], matches: false };
}
