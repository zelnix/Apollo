// The sources Apollo actually consulted for one Threat Case, and exactly what each one returned.
//
// Every entry is built from recorded data only — the event's provenance, its stored Triage record,
// its enforcement evidence, the saved Magnum DI investigation and its cited source references.
// A source that did not answer is reported as such; nothing is inferred and nothing is invented.

import type { DeviceInvestigation } from "../investigation/deviceStore";
import { gapPlainEnglish } from "./triage/contract.ts";
import type { PatrolEvent } from "./types";

export interface CaseSource {
  id: string;
  /** What Apollo consulted, in plain English. */
  name: string;
  /** What that source returned — facts only, no interpretation. */
  returned: string;
  /** When it was consulted, when the record carries a time. */
  at: string | null;
  /** false when the source could not be read or did not answer. */
  answered: boolean;
  /** Present for external references so the UI can open them. */
  url?: string;
}

/** The part of the system a Coverage Gap refers to — so "didn't answer" names something real. */
const GAP_SOURCE: Record<string, string> = {
  PLATFORM_CAPABILITY_UNAVAILABLE: "This device's operating system",
  PERMISSION_UNAVAILABLE: "A permission-gated device check",
  INTELLIGENCE_PROVIDER_UNAVAILABLE: "Threat-reputation service",
  NETWORK_CHECK_FAILED: "Network check",
  CONTENT_NOT_ACCESSIBLE: "The content itself",
  UNSUPPORTED_FILE_TYPE: "File inspection",
  ENCRYPTED_CONTENT: "File inspection",
  EMAIL_HEADERS_UNAVAILABLE: "Email technical headers",
  BROWSER_VISIBILITY_UNAVAILABLE: "Browser session",
  INSUFFICIENT_EVIDENCE: "Available evidence",
  DETERMINISTIC_CHECK_ERROR: "A Triage check",
};

const MECHANISM_SOURCE: Record<string, string> = {
  dns_sinkhole: "Apollo's DNS filter",
  content_policy: "Apollo's content policy filter",
  firewall_rule: "Apollo's firewall rule",
  browser_interstitial: "Apollo's browser warning",
  app_block: "Apollo's app-level block",
  packet_drop: "Apollo's packet filter",
};

export function buildCaseSources(input: { event: PatrolEvent; investigation?: DeviceInvestigation | null }): CaseSource[] {
  const { event, investigation } = input;
  const sources: CaseSource[] = [];

  // 1. Where the finding itself came from.
  if (event.evidence_provenance === "local_device") {
    const count = (event.why ?? []).filter((w) => !!w.trim()).length;
    sources.push({
      id: "device",
      name: "This device",
      returned: count > 0
        ? `Read directly on the device — ${count} recorded detail${count === 1 ? "" : "s"} about the finding`
        : "Read directly on the device — the finding, with no further detail recorded",
      at: event.occurred_at,
      answered: true,
    });
  } else if (event.evidence_provenance === "dns_observation" && event.indicator_host) {
    sources.push({
      id: "dns",
      name: "Apollo's known-threat list",
      returned: `A DNS lookup for ${event.indicator_host} matched a known-threat entry`,
      at: event.occurred_at,
      answered: true,
    });
  } else if (event.evidence_provenance === "server_projected") {
    sources.push({
      id: "server",
      name: "Apollo's servers",
      returned: "A privacy-projected summary of a finding recorded on another device",
      at: event.occurred_at,
      answered: true,
    });
  } else if (event.evidence_provenance === "incomplete") {
    sources.push({
      id: "incomplete",
      name: "Original evidence source",
      returned: "Not available on this device",
      at: event.occurred_at,
      answered: false,
    });
  }

  // 2. The mailbox or app the item was taken from, when intake recorded it.
  const provider = (event.source_metadata?.provider ?? "").trim();
  if (provider) {
    sources.push({
      id: "provider",
      name: `${provider} mailbox`,
      returned: "Supplied the message Apollo checked",
      at: event.source_metadata?.received_at ?? event.occurred_at,
      answered: true,
    });
  }

  // 3. The deterministic Triage checks — outcome and counts, plus every source that didn't answer.
  const triage = event.triage_investigation;
  if (triage) {
    sources.push({
      id: "triage",
      name: `Apollo's Triage checks (rule catalogue v${triage.catalogueVersion})`,
      returned: `${triage.rulesChecked.length} of ${triage.rulesApplicable.length} applicable checks completed, ${triage.rulesMet.length} matched. No AI calls.`,
      at: triage.evaluatedAt,
      answered: true,
    });
    for (const gap of triage.coverageGaps) {
      sources.push({
        id: `gap:${gap.code}`,
        name: GAP_SOURCE[gap.code] ?? "A check Apollo could not complete",
        returned: gap.detail?.trim() || gapPlainEnglish(gap.code),
        at: triage.evaluatedAt,
        answered: false,
      });
    }
  }

  // 4. Apollo's own enforcement, when it genuinely acted.
  if (event.verified_block && event.enforcement_evidence) {
    const ev = event.enforcement_evidence;
    sources.push({
      id: "enforcement",
      name: MECHANISM_SOURCE[ev.mechanism] ?? `Apollo enforcement (${ev.mechanism.replace(/_/g, " ")})`,
      returned: `${ev.enforced_action.replace(/_/g, " ")} — ${ev.result.replace(/_/g, " ")}${ev.destination_domain ? ` for ${ev.destination_domain}` : ""}`,
      at: ev.observed_at,
      answered: true,
    });
  }

  // 5. Magnum DI, when a case was actually investigated.
  const caseId = event.investigation_case_id ?? event.patrol_record?.investigationCaseId;
  if (caseId) {
    const findings = investigation?.response?.findings?.length ?? 0;
    sources.push({
      id: "magnum",
      name: "Magnum DI investigation",
      returned: investigation
        ? `${findings} finding${findings === 1 ? "" : "s"} returned, stored on this device`
        : "Result not stored on this device",
      at: investigation?.completedAt ?? null,
      answered: !!investigation,
    });
  }

  // 6. Every external source the investigation cited, with what it gave back.
  for (const ref of investigation?.sources ?? []) {
    const citing = (investigation?.response?.findings ?? []).filter((f) => f.sourceIds.includes(ref.id));
    const returned = citing.length > 0
      ? citing.map((f) => f.text).join(" ")
      : ref.retrieval === "fetched" ? "Page retrieved; nothing from it was cited in the findings"
        : ref.retrieval === "search_result" ? "Appeared in search results only"
          : "Could not be retrieved";
    sources.push({
      id: `ref:${ref.id}`,
      name: ref.title || ref.url,
      returned,
      at: ref.retrievedAt || null,
      answered: ref.retrieval !== "unavailable",
      url: ref.url,
    });
  }

  // 7. References recorded on the event itself (official guidance Apollo linked to).
  for (const [i, ref] of (event.supporting_references ?? []).entries()) {
    sources.push({
      id: `support:${i}`,
      name: ref.label,
      returned: "Supporting reference recorded with this finding",
      at: null,
      answered: true,
      url: ref.url,
    });
  }

  return sources;
}
