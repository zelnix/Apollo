// Network / Internet Gate adapter — turns a `NetworkAnalysis` into the universal
// `CheckResultModel`. ONE Higgins paragraph, assembled from the real evidence. Technical
// detail stays in `evidence`. Pure, no React.

import type { NetworkAnalysis, NetworkContext } from "./networkAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";

const CONTEXT_LABEL: Record<NetworkContext, string> = {
  home: "Home", work: "Work / school", public: "Public (café, airport, hotel)", unknown: "Not classified",
};

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

/** Build the universal Check Result model for a Network / Internet Gate manual check. */
export function buildNetworkCheckResult(args: {
  analysis: NetworkAnalysis;
  event: PatrolEvent | null;
  context: NetworkContext;
  submissionId: string;
}): CheckResultModel {
  const { analysis: a, event, context, submissionId } = args;
  const subject = a.ssid ? `"${a.ssid}"` : "This network";

  const items: CheckItem[] = [];

  // Connection type & encryption
  const connTech = a.technical.find((t) => t.startsWith("Connection:"));
  const secTech = a.technical.find((t) => t.startsWith("Wi‑Fi security:"));
  items.push({
    id: "net:connection",
    name: "Connection type",
    status: "clear",
    finding: connTech ?? "Connection details not available.",
  });
  if (secTech) {
    const isOpen = secTech.includes("open") || secTech.includes("wep");
    items.push({
      id: "net:security",
      name: "Wi-Fi encryption",
      status: isOpen ? "concern" : secTech.includes("unknown") ? "incomplete" : "clear",
      finding: secTech,
    });
  }

  // Network name check
  if (a.ssid) {
    items.push({
      id: "net:ssid",
      name: "Network name",
      status: a.scenario === "N03" ? "concern" : "clear",
      finding: a.scenario === "N03"
        ? `Network name "${a.ssid}" may not match the expected network.`
        : `Connected to "${a.ssid}".`,
    });
  }

  // Captive portal
  const captiveTech = a.technical.find((t) => t.startsWith("Captive portal:"));
  if (captiveTech && captiveTech.includes("yes")) {
    items.push({
      id: "net:captive",
      name: "Captive portal (sign-in page)",
      status: "concern",
      finding: "This network holds you behind a sign-in page.",
    });
  }

  // VPN status
  const vpnTech = a.technical.find((t) => t.startsWith("VPN:"));
  if (vpnTech) {
    items.push({
      id: "net:vpn",
      name: "VPN status",
      status: vpnTech.includes("active") ? (a.scenario === "N09" ? "concern" : "clear") : "clear",
      finding: vpnTech,
    });
  }

  // Context classification
  items.push({
    id: "net:context",
    name: "Network context",
    status: context === "unknown" ? "incomplete" : "clear",
    finding: `You classified this as: ${CONTEXT_LABEL[context]}.`,
  });

  // Threat Scent
  const scentTech = a.technical.find((t) => t.startsWith("Threat Scent:"));
  if (scentTech && !scentTech.includes("none")) {
    items.push({
      id: "net:scent",
      name: "Threat Scent",
      status: "concern",
      finding: scentTech.replace("Threat Scent: ", "Recent related events: "),
    });
  }

  // Higgins paragraph — evidence-grounded.
  let higginsSays: string;
  let whatToDo: string | undefined;
  if (a.state === "growling" || a.state === "barking") {
    higginsSays = `${a.verdict} ${a.why[0] ?? ""}`.trim();
    whatToDo = a.recommendation;
  } else if (a.state === "ears_up") {
    const qualifier = a.why.length > 1 ? ` ${a.why[1]}` : "";
    higginsSays = `${a.verdict}${qualifier} Apollo can only report what this platform exposes — it cannot inspect traffic or confirm interception.`;
    whatToDo = a.recommendation !== "Nothing to do." ? a.recommendation : undefined;
  } else {
    higginsSays = `${a.verdict} No concerns were identified from the signals this platform exposes.`;
    whatToDo = undefined;
  }

  // Actionable links — help the person secure their connection.
  const whatToDoLinks: ActionLink[] = [];
  if (a.state === "growling" || a.state === "barking") {
    whatToDoLinks.push({ label: "Learn how to stay safe on public Wi-Fi", url: "https://consumer.ftc.gov/articles/how-safely-use-public-wi-fi-networks" });
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
    id: submissionId,
    gate: "Internet Gate",
    checkType: "Network check",
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
