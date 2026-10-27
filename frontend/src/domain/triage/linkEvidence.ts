// Link and website evidence — Higgins Triage's classification of what it had for a link or website check, what each
// lookup let ApolloSG examine, and the investigation signals it raised.
//
//   Link as given              the link itself; none of ApolloSG's lookups answered
//   Link checked               checked against ApolloSG's lookups, but not followed to where it really leads
//   Destination followed       followed by ApolloSG's server to its final destination and checked there
//   Connection seen by Site Gate  Site Gate saw this phone try to connect, and stopped it
//
// Lookups are reported as their sources recorded them (reputation lists, the domain's registry); a clean answer is
// never proof a site is safe. Signals are things to weigh, never proof on their own. Pure, no Expo imports.

import { registrableDomain } from "../brand.ts";
import { formatDomainInfoLine } from "../domainInfo.ts";
import type { DomainInfo, LocalAnalysis } from "../types.ts";
import { capability, fill, newProfile, typeWords, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type LinkVia = "pasted" | "shared" | "qr" | "message" | "recheck" | "site_gate";
export type LinkLevel = "as_given" | "checked" | "followed" | "seen_by_site_gate";

/** What a link check's lookups returned — the shape of IntelResult that matters here. */
export interface LinkIntel {
  verdict?: "clean" | "malicious" | "unknown";
  threat_types?: string[];
  coverage?: string;
  redirect_chain?: string[] | null;
  final_url?: string | null;
  domain_info?: DomainInfo | null;
  sources?: { name: string; status: string; check?: string; detail?: string; failure?: string | null }[];
}

/** A connection Site Gate saw on this phone. `confirmed`: the operating system confirmed the drop. */
export interface SiteObservation { domain: string; observedAt: string; confirmed: boolean }

const WORDS = typeWords("link") as ReturnType<typeof typeWords> & {
  notes: Record<string, string>; upgrade: string; recheck: string; recheckWeaker: string; signals: Record<string, string>;
};
export const LINK_WORDS = WORDS;

/** The link's own structure, as the on-device analyser reads it (its plain words). Codes that are normal on their
 *  own (a long address, a login word) are left out. */
const LOCAL_SIGNALS = new Set(["ip_host", "credentials_in_url", "punycode", "insecure_scheme", "unusual_port", "risky_tld", "shortener",
  "deep_subdomains", "many_hyphens", "encoded_chars", "brand_lookalike", "brand_in_path", "credential_lure"]);

const answered = (intel: LinkIntel | null, failed: boolean) => !!intel && !failed && intel.coverage !== "none";
const destinationGap = (intel: LinkIntel | null) => intel?.sources?.find((s) => s.check === "final_destination" && s.status === "unavailable") ?? null;
const hostOf = (url: string) => url.replace(/^[a-z]+:\/\//i, "").split(/[/?#:]/)[0].toLowerCase();

export function linkLevelFor(intel: LinkIntel | null, failed: boolean): LinkLevel {
  if (!answered(intel, failed)) return "as_given";
  return destinationGap(intel) ? "checked" : "followed";
}

function age(info: DomainInfo): string {
  if (info.age_days == null) return "recently";
  return info.age_days < 1 ? "today" : `${info.age_days} day${info.age_days === 1 ? "" : "s"} ago`;
}

function reputationRow(intel: LinkIntel | null, ok: boolean, failureText: string | null): CapabilityRow {
  if (!ok || !intel) return capability("link", "reputation", "unavailable", null, failureText ?? WORDS.notes.noLookup);
  const lists = (intel.sources ?? []).filter((s) => s.check !== "final_destination" && (s.status === "match" || s.status === "clear"));
  const matches = lists.filter((s) => s.status === "match");
  const value = matches.length
    ? `Listed as ${(intel.threat_types ?? []).join(", ").replace(/_/g, " ").toLowerCase() || "a known threat"} by ${matches.length} of ${lists.length} list${lists.length === 1 ? "" : "s"}`
    : `No match on ${lists.length || "the"} list${lists.length === 1 ? "" : "s"} that answered`;
  return capability("link", "reputation", "recorded", value, WORDS.notes.reputation);
}

function capabilitiesFor(level: LinkLevel, local: LocalAnalysis, intel: LinkIntel | null, ok: boolean, failureText: string | null): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  const url = local.normalizedUrl ?? local.input;
  rows.push(capability("link", "original_url", "observed", url));
  const chain = intel?.redirect_chain ?? [];
  const gap = destinationGap(intel);
  const unreached = !ok ? failureText ?? WORDS.notes.noLookup : gap?.detail ?? WORDS.notes.notFollowed;
  if (level === "followed") {
    rows.push(capability("link", "redirect_chain", "observed", chain.length > 1 ? chain.join(" → ") : "No redirects", WORDS.notes.followedBy));
    rows.push(capability("link", "final_destination", "observed", intel?.final_url ?? `${url} (it doesn't redirect)`, WORDS.notes.followedBy));
  } else {
    rows.push(capability("link", "redirect_chain", "unavailable", null, unreached));
    rows.push(capability("link", "final_destination", "unavailable", null, unreached));
  }
  const info = intel?.domain_info;
  rows.push(ok && info && info.available !== false
    ? capability("link", "domain_registration", "recorded", `${formatDomainInfoLine(info)}${info.newly_registered ? " · newly registered" : ""}`, WORDS.notes.registry)
    : capability("link", "domain_registration", "unavailable", null, ok ? WORDS.notes.registryNoAnswer : failureText ?? WORDS.notes.noLookup));
  rows.push(reputationRow(intel, ok, failureText));
  rows.push(capability("link", "tls_certificate", "unavailable", null, WORDS.notes.tls));
  rows.push(capability("link", "hosting", "unavailable", null, WORDS.notes.hosting));
  return rows;
}

function signalsFor(level: LinkLevel, local: LocalAnalysis, intel: LinkIntel | null, ok: boolean): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  for (const s of local.signals) {
    if (!LOCAL_SIGNALS.has(s.code)) continue;
    if (s.code === "shortener" && level === "followed") continue; // following it showed where it leads
    out.push({ id: s.code, text: s.plain });
  }
  if (level === "followed" && intel?.final_url && local.host) {
    const final = hostOf(intel.final_url);
    if (final && registrableDomain(final) !== registrableDomain(local.host)) out.push({ id: "redirects_elsewhere", text: fill(WORDS.signals.redirects_elsewhere, { final, host: local.host }) });
  }
  const info = ok ? intel?.domain_info : null;
  if (info?.newly_registered) out.push({ id: "newly_registered", text: fill(WORDS.signals.newly_registered, { domain: info.domain, age: age(info) }) });
  if (level === "checked") out.push({ id: "destination_unverified", text: WORDS.signals.destination_unverified });
  return out;
}

/** Higgins Triage's classification of the evidence behind a link check. `failureText`: why the lookups didn't answer. */
export function buildLinkProfile(args: {
  via: LinkVia; local: LocalAnalysis; intel: LinkIntel | null; lookupFailed: boolean; failureText?: string | null; at?: string;
}): EvidenceProfile {
  const ok = answered(args.intel, args.lookupFailed);
  const level = linkLevelFor(args.intel, args.lookupFailed);
  return newProfile({
    type: "link", level, via: args.via, at: args.at,
    capabilities: capabilitiesFor(level, args.local, args.intel, ok, args.failureText ?? null),
    signals: signalsFor(level, args.local, args.intel, ok),
  });
}

/** A website connection Site Gate saw on this phone and stopped. */
export function buildSiteGateProfile(site: SiteObservation): EvidenceProfile {
  const when = new Date(site.observedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return newProfile({
    type: "link", level: "seen_by_site_gate", via: "site_gate", at: site.observedAt,
    capabilities: [
      capability("link", "original_url", "observed", site.domain, WORDS.notes.siteGateOnly),
      capability("link", "connection", "verified", `${site.domain} · ${when}`, WORDS.notes.connectionSeen),
      capability("link", "block", site.confirmed ? "verified" : "recorded", "Stopped", site.confirmed ? WORDS.notes.blockConfirmed : WORDS.notes.blockFlow),
      capability("link", "redirect_chain", "unavailable", null, WORDS.notes.siteGateOnly),
      capability("link", "final_destination", "unavailable", null, WORDS.notes.siteGateOnly),
      capability("link", "tls_certificate", "unavailable", null, WORDS.notes.tls),
      capability("link", "hosting", "unavailable", null, WORDS.notes.hosting),
    ],
    signals: [],
  });
}

/** Same link? A re-check may only change the case it came from. */
export function sameLink(previous: { local_indicator?: string | null; indicator_host?: string | null }, indicator: string, host: string | null): boolean {
  if (previous.local_indicator && previous.local_indicator === indicator) return true;
  const before = previous.indicator_host ?? (previous.local_indicator ? hostOf(previous.local_indicator) : null);
  return !!before && !!host && registrableDomain(before.toLowerCase()) === registrableDomain(host.toLowerCase());
}
