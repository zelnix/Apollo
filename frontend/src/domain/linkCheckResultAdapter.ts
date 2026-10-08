// Link Gate adapter — turns a `CheckOutcome` (from ApolloContext.checkLink) into the universal
// `CheckResultModel`. ONE Higgins paragraph is assembled from the real evidence; no reinvention of
// detection, no reinterpretation of state, no new synthesis. Technical fields live in `evidence`.
// Pure, no React.

import { formatDomainInfoLine } from "./domainInfo";
import type { CheckOutcome } from "@/src/store/ApolloContext";
import type { CheckItem, CheckResultModel } from "./checkResult";
import type { PatrolEvent } from "./types";

const SOURCE_NAME: Record<string, string> = {
  google_safe_browsing: "Google Safe Browsing",
  gsb: "Google Safe Browsing",
  apollo_rules: "Apollo threat list",
  apollo_threat_list: "Apollo threat list",
  intel: "Apollo threat list",
};

function sourceLabel(name: string): string {
  return SOURCE_NAME[name] ?? name.replace(/_/g, " ");
}

function toneForState(state: PatrolEvent["state"] | undefined): CheckResultModel["tone"] {
  if (state === "biting") return "biting";
  if (state === "barking") return "barking";
  if (state === "growling") return "growling";
  if (state === "ears_up") return "ears_up";
  if (state === "resting") return "resting";
  return "neutral";
}

function confidenceLabel(c: "low" | "medium" | "high" | undefined): CheckResultModel["confidence"] {
  return c === "high" ? "High" : c === "low" ? "Low" : "Medium";
}

/** Build the universal Check Result model for a Link Gate manual check. */
export function buildLinkCheckResult(args: {
  outcome: CheckOutcome;
  liveEvent: PatrolEvent | null;
  rawInput: string;
}): CheckResultModel {
  const { outcome, liveEvent, rawInput } = args;
  const state = liveEvent?.state ?? outcome.decision.state;
  const host = outcome.local.host ?? "the link";
  const subject = outcome.local.host || outcome.local.normalizedUrl || rawInput || "the link";

  const items: CheckItem[] = [];

  // Online threat-intelligence sources (Apollo threat list + Google Safe Browsing).
  if (outcome.intel) {
    for (const src of outcome.intel.sources) {
      const status: CheckItem["status"] =
        src.status === "match" ? "concern"
        : src.status === "clear" ? "clear"
        : src.status === "not_configured" ? "not_configured"
        : "unavailable";
      const finding = src.status === "match"
        ? `${sourceLabel(src.name)} listed this address as ${src.threat_types.join(", ") || "a known threat"}.`
        : src.status === "clear"
          ? `${sourceLabel(src.name)} found no known threat matches.`
          : src.status === "not_configured"
            ? `${sourceLabel(src.name)} isn't configured on this build.`
            : `${sourceLabel(src.name)} couldn't respond right now.`;
      items.push({
        id: `src:${src.name}`,
        name: sourceLabel(src.name),
        status,
        finding,
        raw: { threat_types: src.threat_types, detail: src.detail },
      });
    }
  } else if (outcome.intelError) {
    items.push({
      id: "intel:unavailable",
      name: "Online threat lookup",
      status: "unavailable",
      finding: `Online threat lookup wasn't available: ${outcome.intelError}`,
    });
  }

  // Higgins' deeper investigation / page analysis.
  if (outcome.assessment) {
    const status: CheckItem["status"] = state === "barking" || state === "biting"
      ? "concern"
      : state === "growling" || state === "ears_up"
        ? "incomplete"
        : "clear";
    items.push({
      id: "higgins:investigation",
      name: "Higgins investigation",
      status,
      finding: outcome.assessment.higgins.action_kind
        ? `Higgins recommended: ${outcome.assessment.higgins.action_kind.replace(/_/g, " ")}.`
        : "Higgins reviewed the evidence and shared his assessment above.",
      raw: outcome.assessment as unknown as Record<string, unknown>,
    });
  } else if (outcome.investigationError) {
    items.push({
      id: "higgins:unavailable",
      name: "Higgins investigation",
      status: "unavailable",
      finding: `Higgins couldn't complete his investigation: ${outcome.investigationError}`,
    });
  }

  // Domain registration lookup (RDAP).
  if (outcome.intel?.domain_info && outcome.intel.domain_info.available !== false) {
    items.push({
      id: "domain:info",
      name: "Domain registration",
      status: outcome.intel.domain_info.newly_registered ? "concern" : "clear",
      finding: outcome.intel.domain_info.newly_registered
        ? `Domain is newly registered — elevated scam risk. ${formatDomainInfoLine(outcome.intel.domain_info)}`
        : formatDomainInfoLine(outcome.intel.domain_info),
      raw: outcome.intel.domain_info as unknown as Record<string, unknown>,
    });
  } else if (outcome.intel?.domain_info && outcome.intel.domain_info.available === false) {
    items.push({
      id: "domain:info",
      name: "Domain registration",
      status: "unavailable",
      finding: "Domain registration lookup wasn't available for this address.",
    });
  }

  // On-device heuristics — the local analyser.
  items.push({
    id: "local:heuristics",
    name: "On-device heuristics",
    status: outcome.local.level === "malicious" ? "concern"
      : outcome.local.level === "suspicious" ? "incomplete"
      : outcome.local.level === "uncertain" ? "incomplete"
      : "clear",
    finding: `Local risk score ${outcome.local.score}/100 (${outcome.local.level}). Signals: ${outcome.local.signals.map((x) => x.plain).join("; ") || "none."}`,
    raw: { signals: outcome.local.signals, normalizedUrl: outcome.local.normalizedUrl },
  });

  // Compose Higgins' voice: ONE short paragraph (2–4 sentences), evidence-grounded.
  // Priority: barking/biting → warn + what-to-do; growling/ears_up → caution; resting → reassurance
  // with any honest uncertainty from unavailable / incomplete checks.
  const unavailable = items.filter((i) => i.status === "unavailable" || i.status === "incomplete");
  let higginsSays: string;
  let whatToDo: string | undefined;
  if (state === "biting") {
    higginsSays = `Apollo blocked this website. The device's own evidence confirms the block. ${outcome.decision.claimed_brand ? `It was pretending to be ${outcome.decision.claimed_brand}. ` : ""}Nothing further is needed unless you already entered information before the block.`;
    whatToDo = liveEvent?.what_to_do ?? outcome.decision.what_to_do;
  } else if (state === "barking") {
    higginsSays = `${liveEvent?.what_happened ?? outcome.decision.what_happened} ${outcome.decision.claimed_brand ? `The address looks like it's pretending to be ${outcome.decision.claimed_brand}. ` : ""}I'd recommend not opening this link.`;
    whatToDo = liveEvent?.what_to_do ?? outcome.decision.what_to_do;
  } else if (state === "growling" || state === "ears_up") {
    higginsSays = `${liveEvent?.what_happened ?? outcome.decision.what_happened} ${unavailable.length ? "Some of the checks couldn't complete — I've noted which ones below. " : ""}Treat this link with caution until you're sure.`;
    whatToDo = liveEvent?.what_to_do ?? outcome.decision.what_to_do;
  } else {
    // Resting — no known-threat matches, but DO qualify when any check was incomplete.
    const incompleteNames = unavailable.map((i) => i.name).join(" and ");
    const qualifier = incompleteNames
      ? ` Note that ${incompleteNames} ${unavailable.length === 1 ? "was" : "were"} incomplete, so I can't be fully certain about the live page content.`
      : "";
    higginsSays = `Apollo found no known threats for ${host} in the reputation checks it performed.${qualifier} If you intended to visit this address, you can proceed cautiously. If the link arrived unexpectedly, it's safer to visit the service directly.`;
    // Clean result — don't force a next-step button; the paragraph already guides.
    whatToDo = undefined;
  }

  // Compose evidence rows for the "Full investigation details" expand. All existing technical info
  // is preserved — just moved behind progressive disclosure.
  const evidence: CheckResultModel["evidence"] = [];
  evidence.push({ label: "Checked", value: outcome.local.normalizedUrl ?? outcome.local.input });
  if (outcome.intel?.final_url) evidence.push({ label: "Final destination", value: outcome.intel.final_url });
  if (outcome.intel?.redirect_chain?.length) evidence.push({ label: "Redirect chain", value: outcome.intel.redirect_chain.join(" → ") });
  evidence.push({ label: "On-device score", value: `${outcome.local.score}/100 (${outcome.local.level})` });
  if (outcome.intel) {
    evidence.push({ label: "Intel coverage", value: outcome.intel.coverage });
    evidence.push({ label: "Intel verdict", value: outcome.intel.verdict });
  }
  if (outcome.decision.claimed_brand) evidence.push({ label: "Claimed brand", value: outcome.decision.claimed_brand });
  if (liveEvent) {
    evidence.push({ label: "Adapter", value: liveEvent.adapter_label });
    evidence.push({ label: "Verified block", value: liveEvent.verified_block ? "Yes" : "No" });
    evidence.push({ label: "Event id", value: `${liveEvent.event_id.slice(0, 8)}…` });
  }
  evidence.push({
    label: "Privacy",
    value: "Purpose-limited processing. Apollo closes request copies immediately and never later than 15 minutes. Gemini account retention settings have not been independently verified.",
  });

  // Headline — one short sentence summarising the outcome. No competing verdict card.
  const headline = state === "biting"
    ? "Apollo blocked a dangerous website on this device."
    : (liveEvent?.headline ?? outcome.decision.headline);

  return {
    id: outcome.submissionId,
    gate: "Link Gate",
    checkType: "Link check",
    subject,
    headline,
    higginsSays,
    tone: toneForState(state),
    items,
    confidence: confidenceLabel(outcome.decision.confidence),
    whatToDo,
    evidence,
    completedAt: new Date().toISOString(),
    investigationId: liveEvent?.investigation_case_id ?? null,
  };
}
