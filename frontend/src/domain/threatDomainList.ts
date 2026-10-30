// Threat Domain List — what Apollo says about the list of dangerous websites its website protection blocks.
// A valid list with zero Threat Domain Entries is current, not a fault: it means no dangerous websites are listed
// right now. Being current never means "protected": whether protection runs is read from the runtime itself.
// Every sentence here is plain words (Higgins Luddish); the native reason code is kept for technical detail only.
// Pure: no React, no native calls.
import type { RuleBundleStatus } from "@/src/security/SecurityPlatformAdapter";

/** Why this phone didn't accept a Threat Domain List, in plain words, by the native validator's reason. */
const REJECTION_WORDS: Readonly<Record<string, string>> = {
  SIGNATURE_INVALID: "its signature didn't match ApolloSG's",
  SIGNATURE_MISSING: "it wasn't signed by ApolloSG",
  EXPIRED: "it had already expired",
  NOT_YET_VALID: "its start date is still in the future",
  ROLLBACK: "it was older than the list already on this phone",
  VERSION_CONFLICT: "it clashed with the list already on this phone",
  INVALID_RULE: "one of its entries wasn't in the right format",
  INVALID_JSON: "it wasn't in the right format",
  INVALID_SCHEMA: "it wasn't in the right format",
};

export function rejectionWords(reason: string): string {
  return REJECTION_WORDS[reason] ?? "ApolloSG couldn't confirm it was genuine";
}

/** One sentence: the phone turned the list down, and why. */
export function notAcceptedSentence(reason: string): string {
  return `This phone didn't accept ApolloSG's Threat Domain List because ${rejectionWords(reason)}.`;
}

/** What the production runtime reports about the list it holds. */
export interface ThreatDomainListReading {
  ruleExpiresAt?: string | null;
  productionAuthority?: boolean;
  threatDomainEntryCount?: number | null;
}

/** The list's state from the runtime's own reading. Zero entries is current like any other count. */
export function threatDomainListStatus(
  reading: ThreatDomainListReading,
  lastRejection: string | null,
  now: number = Date.now(),
  formatDate: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): RuleBundleStatus {
  const entryCount = typeof reading.threatDomainEntryCount === "number" ? reading.threatDomainEntryCount : null;
  const expiresAt = reading.ruleExpiresAt ?? null;
  if (!expiresAt) {
    return { observable: true, current: null, expiresAt: null, entryCount: null,
      detail: lastRejection
        ? `${notAcceptedSentence(lastRejection)} This isn't a confirmation that it's current.`
        : "Apollo's protection didn't say when its Threat Domain List expires, so Apollo can't confirm it's current." };
  }
  const live = Date.parse(expiresAt) > now;
  const authority = reading.productionAuthority === true;
  return { observable: true, current: live && authority, expiresAt, entryCount,
    detail: live && authority
      ? `Apollo's Threat Domain List is current and valid until ${formatDate(expiresAt)}.`
      : !authority
        ? "Apollo's protection isn't using ApolloSG's own Threat Domain List."
        : `Apollo's Threat Domain List expired on ${formatDate(expiresAt)} and hasn't been updated.` };
}

/** Technical detail: how many Threat Domain Entries the phone holds. Zero is a valid count. */
export function entryCountLine(count: number | null | undefined): string | null {
  if (typeof count !== "number") return null;
  return `${count} Threat Domain ${count === 1 ? "Entry" : "Entries"}`;
}
