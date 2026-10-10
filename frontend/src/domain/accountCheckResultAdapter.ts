// Account Gate adapter — turns an `AccountAnalysis` (from domain/accountAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { AccountAnalysis, AccountProvider, AlertKind } from "./accountAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";

function toneForState(state: string): CheckResultModel["tone"] {
  if (state === "biting") return "biting";
  if (state === "barking") return "barking";
  if (state === "growling") return "growling";
  if (state === "ears_up") return "ears_up";
  if (state === "resting") return "resting";
  return "neutral";
}

function confidenceForState(state: string): CheckResultModel["confidence"] {
  if (state === "barking" || state === "biting") return "High";
  if (state === "growling") return "Medium";
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

  // Actionable links — help the person secure their account.
  const PROVIDER_PASSWORD_URLS: Partial<Record<AccountProvider, string>> = {
    google: "https://myaccount.google.com/security",
    apple: "https://appleid.apple.com/account/manage",
    microsoft: "https://account.live.com/password/reset",
    facebook: "https://www.facebook.com/settings?tab=security",
  };
  const whatToDoLinks: ActionLink[] = [];
  if (a.takeoverRisk === "very_high" || a.takeoverRisk === "high" || a.takeoverRisk === "elevated") {
    const pwUrl = PROVIDER_PASSWORD_URLS[provider];
    if (pwUrl) {
      whatToDoLinks.push({ label: `Change your ${a.providerLabel} password now`, url: pwUrl });
    }
    whatToDoLinks.push({ label: "Check if your email was in a breach", url: "https://haveibeenpwned.com" });
  }

  // Evidence rows.
  const evidence: EvidenceRow[] = a.technical.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      return { label: t.slice(0, colonIndex).trim(), value: t.slice(colonIndex + 1).trim() };
    }
    return { label: "Detail", value: t };
  });
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.title}` });
  if (event) evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });

  return {
    id: event?.event_id ?? `account-${Date.now().toString(36)}`,
    gate: "Account alerts",
    checkType: "Account alert check",
    subject,
    headline: a.title,
    higginsSays,
    tone: toneForState(a.state),
    items,
    confidence: confidenceForState(a.state),
    whatToDo,
    whatToDoLinks: whatToDoLinks.length ? whatToDoLinks : undefined,
    evidence,
    completedAt: new Date().toISOString(),
    investigationId: event?.event_id ?? null,
  };
}
