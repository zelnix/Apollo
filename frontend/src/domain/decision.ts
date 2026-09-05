// Combines local analysis with privacy-preserving intelligence into one
// Apollo decision. Uncertainty lowers confidence and drama, never raises it.

import { assessBrand } from "./brand.ts";
import type { Decision, IntelResult, LocalAnalysis } from "./types";

const THREAT_PLAIN: Record<string, string> = {
  MALWARE: "It is listed for distributing malicious software.",
  SOCIAL_ENGINEERING: "It is listed as a phishing or deception page.",
  UNWANTED_SOFTWARE: "It is listed for pushing unwanted software.",
  POTENTIALLY_HARMFUL_APPLICATION: "It is listed for potentially harmful apps.",
};

export function decide(local: LocalAnalysis, intel: IntelResult | null, trusted: boolean): Decision {
  const host = local.host ?? "this address";
  const brand = local.host ? assessBrand(local.host) : null;
  const chain = intel?.redirect_chain ?? [];
  const localWhy = [
    ...(chain.length > 1 ? [`The link redirected ${chain.length - 1} time${chain.length > 2 ? "s" : ""}: ${chain.join(" → ")}. Apollo judged the final destination.`] : []),
    ...(brand?.mismatch ? [`It looks like ${brand.claimed!.name}${brand.homograph ? " (using look-alike characters)" : ""}, but ${brand.registrable} is not one of ${brand.claimed!.name}'s official domains.`] : []),
    ...local.signals.map((s) => s.plain),
  ];
  const claimed_brand = brand?.claimed?.name ?? null;
  const base = { claimed_brand };
  const intelUnavailable = !intel || intel.coverage === "none";
  const intelPartial = intel?.coverage === "partial";
  const gapNote = intelUnavailable
    ? "Reputation intelligence was unavailable, so this result is based on on-device checks only."
    : intelPartial
      ? "Only part of Apollo's reputation intelligence responded."
      : null;

  // 1. Confirmed by intelligence → Barking (act). Trust never overrides this.
  if (intel?.verdict === "malicious") {
    const why = [...intel.threat_types.map((t) => THREAT_PLAIN[t] ?? `Listed as ${t.toLowerCase().replace(/_/g, " ")}.`), ...localWhy];
    return {
      ...base,
      state: "barking",
      headline: `Don't open ${host}`,
      what_happened: `You checked a link to ${host}. Apollo's intelligence sources list it as a known threat.`,
      why,
      what_to_do: "Do not open this link or enter any details. You can ask Apollo to block this destination.",
      action_required: true,
      trust_allowed: false,
      block_offered: true,
      confidence: "high",
    };
  }

  // 2. Strong local evidence → Barking. Trust does not apply.
  if (local.level === "malicious") {
    return {
      ...base,
      state: "barking",
      headline: `Don't open ${host}`,
      what_happened: `You checked a link to ${host}. Several strong warning signs were found on your device.`,
      why: gapNote ? [...localWhy, gapNote] : localWhy,
      what_to_do: "Treat this as dangerous. Do not open it. You can ask Apollo to block this destination.",
      action_required: true,
      trust_allowed: false,
      block_offered: true,
      confidence: intel?.verdict === "clean" ? "medium" : "high",
    };
  }

  // 2b. Brand & Impersonation: claims/looks like a known organisation but lives elsewhere → Barking (W02/W03/W06/W17).
  if (brand?.mismatch && !trusted) {
    const strong = brand.homograph || local.level !== "clean" || /login|signin|verify|secure|account|auth|update|confirm/i.test(local.normalizedUrl ?? "");
    return {
      ...base,
      state: strong ? "barking" : "growling",
      headline: strong ? `This looks like a fake ${brand.claimed!.name} page` : `${host} is not ${brand.claimed!.name}`,
      what_happened: `You checked a link to ${host}. It presents as ${brand.claimed!.name}, but the website is not one of that organisation's official domains.`,
      why: gapNote ? [...localWhy, gapNote] : localWhy,
      what_to_do: `Do not enter your login, card details or any verification code. Open ${brand.claimed!.name}'s official app or type its address yourself.`,
      action_required: strong,
      trust_allowed: !strong,
      block_offered: true,
      confidence: intel?.verdict === "clean" ? "medium" : "high",
    };
  }

  // 3. Previously trusted, and nothing confirmed malicious → Resting (scoped trust).
  if (trusted) {
    return {
      ...base,
      state: "resting",
      headline: `You trust ${host}`,
      what_happened: `You previously trusted this exact link. No confirmed threat was found.`,
      why: ["Trust only applies to this exact link and never overrides a confirmed threat.", ...(gapNote ? [gapNote] : [])],
      what_to_do: "You can open it. Revoke trust in Settings if you change your mind.",
      action_required: false,
      trust_allowed: false,
      block_offered: false,
      confidence: "medium",
    };
  }

  // 4. Suspicious locally, or uncertain with weak intelligence → Growling.
  if (local.level === "uncertain") {
    return {
      ...base,
      state: "ears_up",
      headline: `I don't know ${host} well yet`,
      what_happened: `You checked a link to ${host}. Nothing confirmed, but a few things are unfamiliar. Unknown does not mean dangerous.`,
      why: gapNote ? [...localWhy, gapNote] : localWhy,
      what_to_do: "Be cautious if it asks for passwords, personal information or payment details. If you weren't expecting this link, don't open it.",
      action_required: false,
      trust_allowed: true,
      block_offered: false,
      confidence: "low",
    };
  }
  const uncertain = local.level === "suspicious";
  if (uncertain) {
    return {
      ...base,
      state: "growling",
      headline: `${host} looks unusual`,
      what_happened: `You checked a link to ${host}. Apollo found signs that are unusual but not confirmed as a threat.`,
      why: gapNote ? [...localWhy, gapNote] : localWhy,
      what_to_do: "If you were not expecting this link, don't open it. If you know and trust the sender, you can trust this exact link.",
      action_required: false,
      trust_allowed: true,
      block_offered: true,
      confidence: "low",
    };
  }

  // 5. Clean locally; intelligence clear or unavailable → Resting within supported checks.
  const why = [
    localWhy.length ? "Minor observations only, none concerning." : "No warning signs found in the address itself.",
    intel?.verdict === "clean" ? "No listing found in Apollo's reputation intelligence." : gapNote ?? "",
    ...(localWhy.length ? localWhy : []),
  ].filter(Boolean);
  return {
    ...base,
    state: "resting",
    headline: `Nothing found for ${host}`,
    what_happened: `You checked a link to ${host}. Nothing concerning was found within the checks Apollo can run.`,
    why,
    what_to_do: intelUnavailable ? "Proceed with normal care. Apollo could not confirm reputation this time." : "You can proceed with normal care. Apollo cannot see the page content itself.",
    action_required: false,
    trust_allowed: false,
    block_offered: false,
    confidence: intel?.verdict === "clean" ? "medium" : "low",
  };
}
