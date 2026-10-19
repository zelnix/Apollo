// Email Gate adapter — turns an `EmailAnalysis` (from domain/emailAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { EmailAnalysis } from "./emailAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import { toneForState, buildEvidenceRowsFromTechnical, appendEventContext, buildCheckResult, buildEvidenceRows } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";


/** Derive confidence from evidence quality, not just the final state.
 *  High: strong direct evidence (confirmed dangerous links, known phishing domain, sender mismatch
 *  combined with deceptive content). Medium: credible circumstantial signals (unfamiliar sender with
 *  urgency, lookalike URLs, risky attachments). Low: limited evidence, incomplete checks, or the
 *  analysis is clean with no strong negative signals to be confident about either way. */
function confidenceFromEvidence(a: EmailAnalysis, urlResults: { verdict: string }[]): CheckResultModel["confidence"] {
  const hasDangerousLink = urlResults.some((r) => r.verdict === "malicious");
  const hasSenderMismatch = /E01|E07/.test(a.scenario);
  const hasDeceptiveContent = a.signals.urgency && (a.signals.loginRequest || a.signals.paymentRequest || a.signals.codeRequest);
  if (hasDangerousLink || (hasSenderMismatch && hasDeceptiveContent)) return "High";
  if (hasSenderMismatch || a.lookalikeUrls.length > 0 || a.riskyAttachments.length > 0 || hasDeceptiveContent) return "Medium";
  return "Low";
}

export function buildEmailCheckResult(args: {
  analysis: EmailAnalysis;
  event: PatrolEvent | null;
  from: string;
  subject: string;
  submissionId: string;
  /** Per-URL reputation results from the link check pass. */
  urlResults: { url: string; verdict: string; host?: string }[];
  /** The explanation that came back from the Higgins backend, if any. */
  explanation: { summary?: string; why?: string[]; recommendation?: string } | null;
}): CheckResultModel {
  const { analysis: a, event, from, subject: subj, submissionId, urlResults, explanation } = args;
  const displaySubject = a.parsed.fromAddress || from.trim() || a.claimedBrand || "Unknown sender";

  const items: CheckItem[] = [];

  // Sender domain check — Gap #6: matching a configured domain confirms the sending
  // infrastructure but Apollo cannot verify SPF/DKIM/DMARC from pasted text alone. Mark as
  // "incomplete" even for official domains to avoid implying full authentication.
  if (a.senderDomain) {
    const isOfficial = a.scenario === "E11";
    const isMismatch = /E01|E07/.test(a.scenario);
    items.push({
      id: "email:sender",
      name: "Sender domain",
      status: isMismatch ? "concern" : "incomplete",
      finding: isMismatch
        ? `Sent from ${a.senderDomain}, which is NOT ${a.claimedBrand}'s official domain.`
        : isOfficial
          ? `Sent from ${a.senderDomain} — a known domain for ${a.claimedBrand}. Apollo matched the domain name only; email authentication (SPF/DKIM) cannot be verified from pasted text.`
          : `Sent from ${a.senderDomain}. Apollo could not match this to a configured known domain.`,
    });
  } else {
    items.push({
      id: "email:sender",
      name: "Sender domain",
      status: "not_performed",
      finding: "No sender address was supplied or detected in the pasted email.",
    });
  }

  // Reply-To check
  if (a.replyToDomain && a.senderDomain && a.replyToDomain !== a.senderDomain) {
    items.push({
      id: "email:replyto",
      name: "Reply-To mismatch",
      status: "concern",
      finding: `Replies would go to ${a.replyToDomain}, not the sender's domain (${a.senderDomain}).`,
    });
  }

  // Links
  if (a.urls.length) {
    const dangerous = urlResults.filter((r) => r.verdict === "malicious").length;
    const offDomain = a.lookalikeUrls.length;
    items.push({
      id: "email:links",
      name: `Links (${a.urls.length})`,
      status: dangerous > 0 || offDomain > 0 ? "concern" : "incomplete",
      finding: dangerous > 0
        ? `${dangerous} link${dangerous > 1 ? "s" : ""} confirmed dangerous.`
        : offDomain > 0
          ? `${offDomain} link${offDomain > 1 ? "s go" : " goes"} to a domain that isn't ${a.claimedBrand}'s.`
          : `${a.urls.length} link${a.urls.length > 1 ? "s" : ""} found — check each with Apollo.`,
      raw: { urls: a.urls, lookalikes: a.lookalikeUrls },
    });
  }

  // Attachments
  if (a.parsed.attachments.length) {
    items.push({
      id: "email:attachments",
      name: `Attachments (${a.parsed.attachments.length})`,
      status: a.riskyAttachments.length > 0 ? "concern" : "clear",
      finding: a.riskyAttachments.length > 0
        ? `Risky type${a.riskyAttachments.length > 1 ? "s" : ""}: ${a.riskyAttachments.join(", ")}.`
        : `${a.parsed.attachments.length} attachment${a.parsed.attachments.length > 1 ? "s" : ""} mentioned. Apollo only sees names from the pasted email.`,
    });
  }

  // Content signals
  const contentSignals: string[] = [];
  if (a.signals.urgency) contentSignals.push("Urgency");
  if (a.signals.threat) contentSignals.push("Threat/penalty");
  if (a.signals.loginRequest) contentSignals.push("Login request");
  if (a.signals.paymentRequest) contentSignals.push("Payment request");
  if (a.signals.codeRequest) contentSignals.push("Code request");
  if (a.signals.identityRequest) contentSignals.push("Identity request");
  if (contentSignals.length) {
    items.push({
      id: "email:signals",
      name: "Content signals",
      status: a.state === "barking" ? "concern" : "incomplete",
      finding: contentSignals.join(", ") + ".",
    });
  }

  // Higgins paragraph — prefer the backend explanation when available.
  const higginsSays = explanation?.summary ?? a.verdict;
  const whatToDo = explanation?.recommendation ?? a.recommendation;

  // Actionable links — help the person report phishing emails or take protective steps.
  const whatToDoLinks: ActionLink[] = [];
  if (a.state === "barking" || a.state === "growling") {
    whatToDoLinks.push(ACTION_LINKS.google_report_phishing);
    whatToDoLinks.push(ACTION_LINKS.ftc_report_fraud);
  }
  if (a.parsed.fromAddress && (a.state === "barking" || a.state === "growling")) {
    whatToDoLinks.push(ACTION_LINKS.apwg_report);
  }

  // Evidence rows — shared utility for technical strings + event context.
  const evidence = buildEvidenceRowsFromTechnical(a.technical);
  if (a.signalLabels.length) evidence.push({ label: "Signals", value: a.signalLabels.join("; ") });
  appendEventContext(evidence, { scenario: `${a.scenario} — ${a.title}`, eventId: event?.event_id });

  return buildCheckResult({
    gate: GATE_REGISTRY.email.checkResultGate,
    checkType: GATE_REGISTRY.email.defaultCheckType,
    subject: displaySubject,
    headline: explanation?.summary ?? a.title,
    higginsSays,
    state: a.state,
    items,
    confidence: confidenceFromEvidence(a, urlResults),
    whatToDo: whatToDo !== "Nothing to do." ? whatToDo : undefined,
    whatToDoLinks,
    evidence,
    event,
    investigationId: submissionId,
  });
}
