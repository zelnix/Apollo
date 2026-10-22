// Native classification → Apollo evidence.
//
// When the OS/OEM gives Apollo legitimate access to its own scam classification, that classification
// becomes TWO things and nothing more:
//   1. a new source of evidence, permanently attributed to the provider that made it, and
//   2. a trigger for Apollo's EXISTING investigation process.
//
// The investigation itself does not change. Apollo does not re-badge a Samsung or Google decision as
// its own, does not raise its own verdict because a provider spoke, and never infers a classification
// from an indirect signal such as a blocked call or an unknown number.
//
// Pure and unit-tested (tests/deviceCapabilities.test.ts). No React, no native imports.

export interface NativeClassificationFact {
  /** The provider that made the call — never "Apollo". */
  provider: string;
  /** The provider's own label, exactly as they reported it. */
  classification: string;
  /** The provider's confidence, not Apollo's. */
  confidence: "low" | "medium" | "high";
  communicationType: "call" | "message";
  /** Number or sender the provider classified. */
  subject: string;
  classifiedAt: string;
}

/** The evidence line Apollo records in `why[]`. Attribution is mandatory and comes first. */
export function nativeClassificationWhyLine(fact: NativeClassificationFact): string {
  const what = fact.communicationType === "call" ? "call" : "message";
  return `${fact.provider} classified this ${what} as “${fact.classification}” (${fact.confidence} confidence, ${fact.provider}’s own rating). This is ${fact.provider}’s finding, reported by Apollo — not an Apollo detection.`;
}

/** The line Higgins uses when he explains where the warning came from. */
export function nativeClassificationHigginsLine(fact: NativeClassificationFact): string {
  const what = fact.communicationType === "call" ? "call" : "message";
  return `Your device flagged this ${what} first — ${fact.provider} called it “${fact.classification}”. I took that as a reason to look properly, and what follows is Apollo’s own investigation, not theirs.`;
}

/** Attribution block stored with the case so the provider is never lost. Keys mirror SourceMetadata. */
export function nativeClassificationAttribution(fact: NativeClassificationFact): {
  type: "call" | "text";
  subject: string;
  preview: string;
  provider: string;
  provider_classification: string;
  provider_confidence: string;
} {
  return {
    type: fact.communicationType === "call" ? "call" : "text",
    subject: fact.subject,
    preview: `${fact.provider}: ${fact.classification}`,
    provider: fact.provider,
    provider_classification: fact.classification,
    provider_confidence: fact.confidence,
  };
}

export const NATIVE_PROTECTION_PROVENANCE = "native_protection" as const;

/** Evidence provenance for a finding that STARTED with the device's own protection. The provider
 *  itself is kept on `source_metadata.provider`, so the case always names who made the call. */
export function nativeClassificationProvenance(): typeof NATIVE_PROTECTION_PROVENANCE {
  return NATIVE_PROTECTION_PROVENANCE;
}

/**
 * A permitted native classification is always a trigger for Apollo's existing investigation —
 * whatever Apollo's own deterministic checks concluded. The provider saw something Apollo may not
 * be able to see, so the case is investigated rather than closed on Apollo's reading alone.
 */
export function triggersInvestigation(fact: NativeClassificationFact | null): boolean {
  return fact !== null;
}
