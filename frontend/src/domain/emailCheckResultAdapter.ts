// Email Gate adapter — turns an `EmailAnalysis` (from domain/emailAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { EmailAnalysis } from "./emailAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import { toneForState, buildEvidenceRowsFromTechnical, appendEventContext, buildCheckResult, buildEvidenceRows } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";
import type { EmailEvidenceProfile } from "./triage/emailEvidence";
import type { OfficialVerdict } from "./officialContacts";

const FAILED_AUTH = new Set(["fail", "softfail", "permerror", "hardfail"]);

/** Sender authentication, exactly as the receiving mail server recorded it — ApolloSG never re-checks it. */
function authItem(profile: EmailEvidenceProfile | null | undefined): CheckItem {
  const base = { id: "email:auth", name: "Sender authentication (SPF, DKIM, DMARC)" };
  if (!profile || profile.rank < 3) {
    return { ...base, status: "not_performed", finding: `Needs the original email with its full headers. ApolloSG received ${profile?.received ?? "a copy without them"}.` };
  }
  const auth = profile.auth;
  if (!auth) return { ...base, status: "incomplete", finding: "The receiving mail server didn't record SPF, DKIM or DMARC results in this email." };
  const server = auth.recordedBy === "unknown" ? "the receiving mail server" : auth.recordedBy;
  const results = (["spf", "dkim", "dmarc"] as const).map((m) => `${m.toUpperCase()} ${auth[m] ?? "not recorded"}`).join(", ");
  const failed = (["spf", "dkim", "dmarc"] as const).some((m) => FAILED_AUTH.has(auth[m] ?? ""));
  const allPass = (["spf", "dkim", "dmarc"] as const).every((m) => auth[m] === "pass");
  const credit = auth.receiverConfirmed ? `Recorded by ${server}, the mail server that received it` : `Recorded in the email by ${server} (ApolloSG couldn't match it to the servers that delivered it)`;
  return {
    ...base,
    status: failed ? "concern" : allPass ? "clear" : "incomplete",
    finding: `${credit}: ${results}. ApolloSG reports these as recorded and didn't re-check them.${allPass ? " Passing confirms only which domain sent it — it never makes an email safe." : ""}`,
    raw: { recorded_by: server, spf: auth.spf ?? "not recorded", dkim: auth.dkim ?? "not recorded", dmarc: auth.dmarc ?? "not recorded", arc: auth.arc ?? "not recorded" },
  };
}


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
  /** Reputation results for the telephone/mobile numbers found in the email itself. */
  phones?: { raw: string; decision: string; fraud_score: number | null }[];
  /** The explanation that came back from the Higgins backend, if any. */
  explanation: { summary?: string; why?: string[]; recommendation?: string } | null;
  /** Higgins Triage's classification of the email evidence (L1–L4). */
  profile?: EmailEvidenceProfile | null;
  /** The Official Organisation Directory's verdict on the email's sender, links, numbers and addresses. */
  official?: OfficialVerdict[] | null;
}): CheckResultModel {
  const { analysis: a, event, from, subject: subj, submissionId, urlResults, explanation } = args;
  const headers = (args.profile?.rank ?? 0) >= 3;
  const phones = args.phones ?? [];
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
          ? `Sent from ${a.senderDomain} — a known domain for ${a.claimedBrand}.${headers ? " See sender authentication for what the receiving mail server recorded." : " Apollo matched the domain name only; email authentication (SPF/DKIM) cannot be verified from pasted text."}`
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

  items.push(authItem(args.profile));

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
          : `${a.urls.length} link${a.urls.length > 1 ? "s" : ""} found — check each with ApolloSG.`,
      raw: { urls: a.urls, lookalikes: a.lookalikeUrls },
    });
  }

  // Phone numbers inside the email, each checked against the caller-reputation service.
  if (phones.length) {
    const flagged = phones.filter((p) => p.decision === "avoid" || p.decision === "review");
    const unchecked = phones.filter((p) => p.decision === "unknown");
    items.push({
      id: "email:phones",
      name: `Phone numbers (${phones.length})`,
      status: flagged.length ? "concern" : unchecked.length === phones.length ? "incomplete" : "clear",
      finding: flagged.length
        ? `${flagged.map((p) => `${p.raw} — ${p.decision === "avoid" ? "strong fraud or spam signals" : "some risk signals"}${p.fraud_score === null ? "" : ` (fraud score ${p.fraud_score}/100)`}`).join("; ")}.`
        : unchecked.length === phones.length
          ? `${phones.map((p) => p.raw).join(", ")} — reputation data was unavailable, so ${phones.length === 1 ? "it was" : "they were"} not checked.`
          : `${phones.map((p) => p.raw).join(", ")} — no fraud or abuse signals reported.`,
      raw: { phones },
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
  if (args.profile) evidence.push({ label: "Evidence level", value: `${args.profile.label} — classified by ${args.profile.classifiedBy}` });
  appendEventContext(evidence, { scenario: `${a.scenario} — ${a.title}`, eventId: event?.event_id });

  return { ...buildCheckResult({
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
  }), evidenceProfile: args.profile ?? null, official: args.official };
}
