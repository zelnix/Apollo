// Runtime guard for the reputation-intelligence contract (Hardening Gate step 3: malformed payloads).
// A response that doesn't match the contract is REJECTED and treated as "intelligence unavailable" —
// never as clean. Only shapes that could turn a broken answer into an optimistic verdict are checked.

import type { DomainInfo, IntelCoverage, IntelResult, IntelSource, IntelVerdict } from "./types";

const VERDICTS: IntelVerdict[] = ["clean", "malicious", "unknown"];
const COVERAGES: IntelCoverage[] = ["full", "partial", "none"];
const SOURCE_STATUS: IntelSource["status"][] = ["match", "clear", "unavailable", "not_configured"];

const isStr = (v: unknown): v is string => typeof v === "string";
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isStr) ? v : null);

// RDAP domain info is presentational context, never a security verdict — a malformed/absent value
// simply means "no domain info to show", it never rejects the whole intel result.
function parseDomainInfo(v: unknown): DomainInfo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.domain)) return null;
  return {
    domain: o.domain,
    registrar: isStr(o.registrar) ? o.registrar : null,
    registered_at: isStr(o.registered_at) ? o.registered_at : null,
    registrant_organization: isStr(o.registrant_organization) ? o.registrant_organization : null,
    rdap_server: isStr(o.rdap_server) ? o.rdap_server : null,
    age_days: typeof o.age_days === "number" ? o.age_days : null,
    newly_registered: o.newly_registered === true,
    available: o.available !== false,
    error: isStr(o.error) ? o.error : null,
  };
}

export function parseIntelResult(raw: unknown): IntelResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!VERDICTS.includes(r.verdict as IntelVerdict) || !COVERAGES.includes(r.coverage as IntelCoverage)) return null;
  if (!isStr(r.indicator_digest) || !isStr(r.checked_at)) return null;
  const threat_types = strList(r.threat_types);
  if (!threat_types) return null;
  if (!Array.isArray(r.sources)) return null;
  const sources: IntelSource[] = [];
  for (const s of r.sources as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    const st = strList(o.threat_types) ?? [];
    if (!isStr(o.name) || !SOURCE_STATUS.includes(o.status as IntelSource["status"])) return null;
    sources.push({ name: o.name, status: o.status as IntelSource["status"], detail: isStr(o.detail) ? o.detail : "", threat_types: st });
  }
  // A "malicious" verdict must be backed by at least one matching source; "clean" must not carry unavailable sources as full coverage.
  if (r.verdict === "malicious" && !sources.some((s) => s.status === "match")) return null;
  if (r.verdict === "clean" && r.coverage === "full" && sources.some((s) => s.status !== "clear")) return null;
  const redirect_chain = strList(r.redirect_chain) ?? undefined;
  return {
    verdict: r.verdict as IntelVerdict, coverage: r.coverage as IntelCoverage, threat_types, sources, indicator_digest: r.indicator_digest, checked_at: r.checked_at,
    cached: r.cached === true, redirect_chain, final_url: isStr(r.final_url) ? r.final_url : null, domain_info: parseDomainInfo(r.domain_info),
  };
}
