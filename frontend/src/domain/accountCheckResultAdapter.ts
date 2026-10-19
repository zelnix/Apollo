// Account Gate adapter — turns an `AccountAnalysis` (from domain/accountAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { AccountAnalysis, AccountProvider, AlertKind } from "./accountAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import { toneForState, buildEvidenceRowsFromTechnical, appendEventContext, buildCheckResult } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";


/** Derive confidence from evidence quality, not just the final state.
 *  High: strong direct evidence (very_high/high takeover risk combined with user-didn't-initiate,
 *  suspicious URLs in the alert). Medium: elevated takeover risk or user is unsure.
 *  Low: user initiated the action, or low assessed risk. */
function confidenceFromEvidence(a: AccountAnalysis, initiated: boolean | null): CheckResultModel["confidence"] {
  const highRisk = a.takeoverRisk === "very_high" || a.takeoverRisk === "high";
  const hasSuspiciousUrls = a.suspiciousUrls.length > 0;
  if (highRisk && initiated === false) return "High";
  if (hasSuspiciousUrls && initiated === false) return "High";
  if (highRisk || a.takeoverRisk === "elevated" || hasSuspiciousUrls) return "Medium";
  return "Low";
}

export function buildAccountCheckResult(args: {
  analysis: AccountAnalysis;
  event: PatrolEvent | null;
  provider: AccountProvider;
  kind: AlertKind;
  initiated: boolean | null;
}): CheckResultModel {
  const { analysis: a, event, provider, kind, initiated } = args;
  const subject = a.providerLabel || "Account alert";

  const items: CheckItem[] = [];

  // Takeover risk
  items.push({
    id: "account:risk",
    name: "Takeover risk",
    status: a.takeoverRisk === "very_high" || a.takeoverRisk === "high" ? "concern" : a.takeoverRisk === "elevated" ? "incomplete" : "clear",
    finding: `Assessed takeover risk: ${a.takeoverRisk}.`,
  });

  // Links in alert
  if (a.urls.length) {
    items.push({
      id: "account:links",
      name: `Links in alert (${a.urls.length})`,
      status: a.suspiciousUrls.length > 0 ? "concern" : "clear",
      finding: a.suspiciousUrls.length > 0
        ? `${a.suspiciousUrls.length} link${a.suspiciousUrls.length > 1 ? "s go" : " goes"} to a domain that isn't ${a.providerLabel}'s.`
        : `${a.urls.length} link${a.urls.length > 1 ? "s" : ""} found — all match ${a.providerLabel}'s known domains.`,
      raw: { urls: a.urls, suspicious: a.suspiciousUrls },
    });
  }

  // User initiated
  items.push({
    id: "account:initiated",
    name: "You initiated this",
    status: initiated === true ? "clear" : initiated === false ? "concern" : "incomplete",
    finding: initiated === true
      ? "You reported that you started this action."
      : initiated === false
        ? "You reported that you did NOT start this."
        : "Not sure whether you started this.",
  });

  // Higgins paragraph.
  const higginsSays = a.verdict;
  const whatToDo = a.recommendation;

  // Actionable links — from the canonical action registry.
  const PROVIDER_SECURITY_LINKS: Partial<Record<AccountProvider, ActionLink>> = {
    google: ACTION_LINKS.google_account_security,
    apple: ACTION_LINKS.apple_account_manage,
    microsoft: ACTION_LINKS.microsoft_password_reset,
    facebook: ACTION_LINKS.facebook_security_settings,
  };
  const whatToDoLinks: ActionLink[] = [];
  if (a.takeoverRisk === "very_high" || a.takeoverRisk === "high" || a.takeoverRisk === "elevated") {
    const pwLink = PROVIDER_SECURITY_LINKS[provider];
    if (pwLink) {
      whatToDoLinks.push({ label: `Change your ${a.providerLabel} password now`, url: pwLink.url });
    }
    whatToDoLinks.push(ACTION_LINKS.hibp_check);
  }

  // Evidence rows — shared utility.
  const evidence = buildEvidenceRowsFromTechnical(a.technical);
  appendEventContext(evidence, { scenario: `${a.scenario} — ${a.title}`, eventId: event?.event_id });

  return buildCheckResult({
    gate: GATE_REGISTRY.account.checkResultGate,
    checkType: GATE_REGISTRY.account.defaultCheckType,
    subject,
    headline: a.title,
    higginsSays,
    state: a.state,
    items,
    confidence: confidenceFromEvidence(a, initiated),
    whatToDo,
    whatToDoLinks,
    evidence,
    event,
  });
}
