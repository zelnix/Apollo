// Email Gate adapter — turns an `EmailAnalysis` (from domain/emailAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { EmailAnalysis } from "./emailAnalysis";
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

  // Sender domain check
  if (a.senderDomain) {
    const isOfficial = a.scenario === "E11";
    const isMismatch = /E01|E07/.test(a.scenario);
    items.push({
      id: "email:sender",
      name: "Sender domain",
      status: isMismatch ? "concern" : isOfficial ? "clear" : "incomplete",
      finding: isMismatch
        ? `Sent from ${a.senderDomain}, which is NOT ${a.claimedBrand}'s official domain.`
        : isOfficial
          ? `Sent from ${a.senderDomain} — an official domain for ${a.claimedBrand}. This confirms the sending infrastructure, not the email's content.`
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
    whatToDoLinks.push({ label: "Report phishing to Google", url: "https://safebrowsing.google.com/safebrowsing/report_phish/" });
    whatToDoLinks.push({ label: "Report fraud to the FTC", url: "https://reportfraud.ftc.gov" });
  }
  if (a.parsed.fromAddress && (a.state === "barking" || a.state === "growling")) {
    whatToDoLinks.push({ label: "Report phishing email to Anti-Phishing Working Group", url: "mailto:reportphishing@apwg.org" });
  }

  // Evidence rows — the expandable "Full investigation details".
  const evidence: EvidenceRow[] = a.technical.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      return { label: t.slice(0, colonIndex).trim(), value: t.slice(colonIndex + 1).trim() };
    }
    return { label: "Detail", value: t };
  });
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.title}` });
  if (a.signalLabels.length) evidence.push({ label: "Signals", value: a.signalLabels.join("; ") });
  if (event) evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });

  return {
    id: submissionId,
    gate: "Email Gate",
    checkType: "Email check",
    subject: displaySubject,
    headline: explanation?.summary ?? a.title,
    higginsSays,
    tone: toneForState(a.state),
    items,
    confidence: confidenceForState(a.state),
    whatToDo: whatToDo !== "Nothing to do." ? whatToDo : undefined,
    whatToDoLinks: whatToDoLinks.length ? whatToDoLinks : undefined,
    evidence,
    completedAt: new Date().toISOString(),
    investigationId: event?.event_id ?? null,
  };
}
