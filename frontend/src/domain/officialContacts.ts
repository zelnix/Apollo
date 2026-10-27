// The Official Organisation Directory's verdict on the websites, phone numbers and email addresses a check holds
// (backend services/org_directory.py). Pure: parsing, finding which listed organisation material names, and the
// plain-English lines every check result shows. A verdict never changes a result's outcome.

export type OfficialKind = "site" | "phone" | "email";
export type OfficialStatus = "official" | "published" | "lookalike" | "shared_service" | "not_official" | "not_published";
export interface OfficialContactRef { value: string; label: string; source_url: string | null }
export interface OfficialVerdict {
  kind: OfficialKind;
  value: string;
  status: OfficialStatus;
  /** The organisation, as the directory names it ("CommBank", "the ATO"). */
  name: string;
  label: string;
  domain: string | null;
  official_domain: string | null;
  detail: string | null;
  /** The organisation's published contacts to use instead (for a number or address that isn't its own). */
  use_instead: OfficialContactRef[];
  /** The organisation's own email domains (for an address that isn't its own). */
  domains: string[];
  /** The organisation's own page the verdict was traced to. */
  source_url: string | null;
}
export interface OrganisationNames { name: string; aliases: string[] }

const KINDS: OfficialKind[] = ["site", "phone", "email"];
const STATUSES: OfficialStatus[] = ["official", "published", "lookalike", "shared_service", "not_official", "not_published"];
const WARNINGS: OfficialStatus[] = ["lookalike", "shared_service", "not_official", "not_published"];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const https = (v: unknown): string | null => { const s = str(v); return s && /^https:\/\//i.test(s) ? s : null; };

/** One verdict as the server sent it, or null when it isn't one (an unreadable verdict is never shown). */
export function parseOfficialVerdict(raw: unknown, fallback?: { kind: OfficialKind; value: string }): OfficialVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = (KINDS.includes(o.kind as OfficialKind) ? o.kind : fallback?.kind) as OfficialKind | undefined;
  const value = str(o.value) ?? str(fallback?.value) ?? str(o.domain);
  const name = str(o.name);
  if (!kind || !value || !name || !STATUSES.includes(o.status as OfficialStatus)) return null;
  const refs = Array.isArray(o.use_instead) ? o.use_instead : [];
  return {
    kind, value, name, status: o.status as OfficialStatus,
    label: str(o.label) ?? "", domain: str(o.domain), official_domain: str(o.official_domain), detail: str(o.detail),
    use_instead: refs.flatMap((r) => {
      const ref = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      const v = str(ref.value);
      return v ? [{ value: v, label: str(ref.label) ?? "", source_url: https(ref.source_url) }] : [];
    }),
    domains: Array.isArray(o.domains) ? o.domains.filter((d): d is string => typeof d === "string") : [],
    source_url: https(o.source_url),
  };
}

/** `{verdicts: [...]}` from POST /official/contacts; null when the answer can't be read. */
export function parseOfficialVerdicts(raw: unknown): OfficialVerdict[] | null {
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>).verdicts : null;
  if (!Array.isArray(list)) return null;
  return list.map((v) => parseOfficialVerdict(v)).filter((v): v is OfficialVerdict => !!v);
}

export function parseOrganisationNames(raw: unknown): OrganisationNames[] {
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>).organisations : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((o) => {
    const r = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
    const name = str(r.name);
    return name ? [{ name, aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string" && a.length >= 2) : [] }] : [];
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The listed organisation the material names first ("Your CommBank account…" → "CommBank"), or null. Names are matched
 *  as whole words; "the ATO" also matches "ATO". */
export function namedOrganisation(text: string, organisations: OrganisationNames[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const org of organisations) {
    for (const alias of new Set([org.name.replace(/^the\s+/i, ""), ...org.aliases])) {
      const m = new RegExp(`(^|[^a-z0-9])${escape(alias).replace(/\s+/g, "\\s+")}(?![a-z0-9])`, "i").exec(text);
      if (m && (!best || m.index < best.at)) best = { name: org.name, at: m.index };
    }
  }
  return best?.name ?? null;
}

export const isOfficialWarning = (v: OfficialVerdict) => WARNINGS.includes(v.status);

export interface OfficialContactLine {
  id: string;
  warning: boolean;
  title: string;
  text: string;
  /** The organisation's own contacts to use instead (tel:, mailto: or https links). */
  useInstead: { label: string; url: string }[];
  /** Where ApolloSG found it: the organisation's own page. */
  source: { label: string; url: string } | null;
}

const dial = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;
const contactUrl = (kind: OfficialKind, value: string) => (kind === "phone" ? dial(value) : kind === "email" ? `mailto:${value}` : `https://${value}`);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const labelled = (label: string) => (label ? ` (${label})` : "");

/** Plain-English lines, warnings first. */
export function officialContactLines(verdicts: OfficialVerdict[]): OfficialContactLine[] {
  const lines = verdicts.map((v, i): OfficialContactLine => {
    const where = v.domain ?? v.value;
    const own = v.official_domain ? [{ label: `Use ${v.official_domain}, ${v.name}'s own website`, url: `https://${v.official_domain}` }] : [];
    const instead = v.use_instead.map((c) => ({ label: `${c.value}${c.label ? ` · ${c.label}` : ""}`, url: contactUrl(v.kind, c.value) }));
    const page = v.source_url ?? v.use_instead.find((c) => c.source_url)?.source_url ?? null;
    const source = page ? { label: `${upper(v.name)}'s own page, where ApolloSG checked this`, url: page } : null;
    const base = { id: `official-${v.kind}-${i}`, warning: isOfficialWarning(v), source };
    switch (v.status) {
      case "official":
        return { ...base, title: "Official website", text: `${where} is ${v.name}'s own website.`, useInstead: [] };
      case "published":
        return { ...base, title: v.kind === "phone" ? "Official number" : "Official email address",
          text: `${v.value} is ${v.name}'s published ${v.kind === "phone" ? "number" : "address"}${labelled(v.label)}.`, useInstead: [] };
      case "lookalike":
        return { ...base, title: "Not the official website",
          text: `${where} uses ${v.name}'s name, but it isn't ${v.name}'s website${v.detail ? `: ${v.detail}` : ""}.`, useInstead: own };
      case "shared_service":
        return { ...base, title: "Not the official website",
          text: `${where} isn't ${v.name}'s website${v.detail ? `: ${v.detail}` : ""}.`, useInstead: own };
      case "not_official":
        return { ...base, title: "Not the official website",
          text: `This says it's from ${v.name}, but ${where} isn't one of ${v.name}'s websites.`, useInstead: own };
      case "not_published":
        if (v.kind === "phone") {
          return { ...base, title: "Not the official number",
            text: `This says it's from ${v.name}, but ${v.value} isn't one of ${v.name}'s published numbers. To contact ${v.name}, use a number it publishes itself.`,
            useInstead: instead };
        }
        return { ...base, title: "Not the official email address",
          text: `This says it's from ${v.name}, but ${v.value} isn't one of ${v.name}'s addresses${v.domains.length ? ` (${v.name} uses ${v.domains.join(", ")})` : ""}.`,
          useInstead: instead };
    }
  });
  return [...lines.filter((l) => l.warning), ...lines.filter((l) => !l.warning)];
}
