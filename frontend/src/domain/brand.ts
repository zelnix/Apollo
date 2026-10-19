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
  { name: "Amazon", tokens: ["amazon"], official: ["amazon.com", "amazon.com.au"] },
  { name: "Netflix", tokens: ["netflix"], official: ["netflix.com"] },
  { name: "Facebook", tokens: ["facebook", "meta"], official: ["facebook.com", "fb.com", "meta.com"] },
];

/** Registrable domain (eTLD+1) with AU second-level suffixes handled. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  const secondLevel = new Set(["com.au", "net.au", "org.au", "gov.au", "edu.au", "co.uk", "co.nz", "org.uk", "com.br"]);
  return secondLevel.has(last2) ? labels.slice(-3).join(".") : last2;
}

/** Undo common look-alike substitutions: paypa1 → paypal, micr0soft → microsoft, rn → m, vv → w. */
export function deobfuscate(label: string): string {
  return label.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s").replace(/rn/g, "m").replace(/vv/g, "w").replace(/[^a-z]/g, "");
}

export interface BrandAssessment {
  claimed: BrandRecord | null;
  /** True when the host mentions/looks like the brand but is not one of its official domains. */
  mismatch: boolean;
  /** True when the match only appears after undoing character substitutions (homograph/lookalike). */
  homograph: boolean;
  registrable: string;
  isOfficial: boolean;
}

export function assessBrand(host: string, hintBrand?: string | null): BrandAssessment {
  const reg = registrableDomain(host);
  const compact = host.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deob = deobfuscate(host);
  let claimed: BrandRecord | null = null; let homograph = false;
  for (const b of OFFICIAL_DOMAINS) {
    const direct = b.tokens.some((t) => t.length >= 3 && (t.length >= 5 ? compact.includes(t) : host.toLowerCase().split(/[.-]/).includes(t)));
    const fuzzy = !direct && b.tokens.some((t) => t.length >= 5 && deob.includes(t));
    if (direct || fuzzy) { claimed = b; homograph = fuzzy; break; }
  }
  if (!claimed && hintBrand) claimed = OFFICIAL_DOMAINS.find((b) => b.name.toLowerCase() === hintBrand.toLowerCase()) ?? null;
  const isOfficial = !!claimed && claimed.official.some((o) => reg === o || host.toLowerCase().endsWith(`.${o}`));
  return { claimed, mismatch: !!claimed && !isOfficial, homograph, registrable: reg, isOfficial };
}

/** Verify Website: plain-language comparison for the sheet. */
export function verifyWebsite(host: string, hintBrand?: string | null): { title: string; lines: string[]; matches: boolean | null } {
  const a = assessBrand(host, hintBrand);
  if (!a.claimed) return { title: "No organisation claim to check", lines: [`Current website: ${a.registrable}`, "This address doesn't mention a known organisation, so there's nothing to compare. Judge it by what it asks you for."], matches: null };
  if (a.isOfficial) return { title: "These match", lines: [`Claimed organisation: ${a.claimed.name}`, `Current website: ${a.registrable}`, `Official ${a.claimed.name} domains include: ${a.claimed.official.join(", ")}`], matches: true };
  return { title: "These do not match", lines: [`Claimed organisation: ${a.claimed.name}`, `Current website: ${a.registrable}${a.homograph ? " (uses look-alike characters)" : ""}`, `Official ${a.claimed.name} domains: ${a.claimed.official.join(", ")}`, "Open the organisation's official app or type its address yourself — never use details from this page."], matches: false };
}
