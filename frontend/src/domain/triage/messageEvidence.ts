// Message evidence — Higgins Triage's classification of how a text message reached ApolloSG (pasted, a screenshot,
// shared from an app, read from the device's messages or its notification), what it could examine and the signals
// it raised. Who really sent a message is never verifiable: messaging apps don't share it. Pure, no Expo imports.

import { capability, fill, newProfile, typeWords, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type MessageVia = "pasted" | "screenshot" | "shared" | "captured" | "inbox" | "recheck";

const WORDS = typeWords("message") as ReturnType<typeof typeWords> & {
  notes: Record<string, string>; signals: Record<string, string>; upgrade: string; recheck: string;
};
export const MESSAGE_WORDS = WORDS;

const LEVEL: Record<Exclude<MessageVia, "recheck">, string> = {
  pasted: "pasted", screenshot: "screenshot", shared: "shared", captured: "captured", inbox: "inbox",
};

/** What the message check found that matters for its evidence (shapes of MessageSignals / url and number results). */
export interface MessageEvidenceInput {
  via: MessageVia;
  /** A re-check keeps the level of the evidence the case already had. */
  level?: string;
  /** A preview sample standing in for `via`: processed exactly as `via`, only tagged. */
  simulated?: boolean;
  sender: string;
  /** When the device recorded it arriving (messages app or notification), ISO. */
  receivedAt?: string | null;
  /** The app that posted the notification, when captured from one. */
  app?: string | null;
  provider?: { provider: string; classification: string } | null;
  signals: { platformSwitch?: boolean; newNumber?: boolean; callbackNumber?: string | null; claimedBrand?: string | null };
  urls: { coverage: string; failure?: string | null; verdict?: string }[];
  phones: { decision: string }[];
  at?: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const unanswered = (u: { coverage: string; failure?: string | null }) => u.coverage === "none" || u.coverage === "unavailable" || !!u.failure;

function lookupRow(id: "links" | "numbers", total: number, failed: number, flagged: number, words: { checked: string; partly: string; none: string; noun: string }): CapabilityRow {
  if (!total) return capability("message", id, "observed", "None", words.none);
  const note = failed ? fill(words.partly, { failed: String(failed), total: String(total) }) : words.checked;
  if (failed === total) return capability("message", id, "unavailable", plural(total, words.noun), note);
  return capability("message", id, "recorded", `${plural(total - failed, words.noun)} checked${flagged ? `, ${flagged} flagged` : ""}`, note);
}

export function buildMessageProfile(input: MessageEvidenceInput): EvidenceProfile {
  const via = input.via;
  const level = input.level ?? LEVEL[via === "recheck" ? "pasted" : via];
  const stored = via === "inbox" || via === "captured";
  const sender = input.sender.trim();
  const failedUrls = input.urls.filter(unanswered).length;
  const flaggedUrls = input.urls.filter((u) => u.verdict === "malicious").length;
  const failedPhones = input.phones.filter((p) => p.decision === "unknown").length;
  const flaggedPhones = input.phones.filter((p) => p.decision === "avoid" || p.decision === "review").length;
  const caps: CapabilityRow[] = [
    sender
      ? capability("message", "sender", stored ? "recorded" : "observed", sender, stored ? WORDS.notes.senderStored : WORDS.notes.senderAsShown)
      : capability("message", "sender", "unavailable", null, WORDS.notes.senderMissing),
    stored && input.receivedAt
      ? capability("message", "timestamp", "recorded", when(input.receivedAt), input.app ? `${WORDS.notes.timeStored} (${input.app})` : WORDS.notes.timeStored)
      : capability("message", "timestamp", "unavailable", null, WORDS.notes.timeMissing),
    capability("message", "source", "verified", typeWords("message").via?.[via] ?? via, via === "screenshot" ? WORDS.notes.screenshotText : WORDS.notes.sourceKnown),
    input.provider
      ? capability("message", "platform_provenance", "recorded", `${input.provider.provider}: ${input.provider.classification}`, fill(WORDS.notes.provenanceProvider, { provider: input.provider.provider }))
      : capability("message", "platform_provenance", "unavailable", null, WORDS.notes.provenance),
    lookupRow("links", input.urls.length, failedUrls, flaggedUrls, { checked: WORDS.notes.linksChecked, partly: WORDS.notes.linksPartly, none: WORDS.notes.noLinks, noun: "link" }),
    lookupRow("numbers", input.phones.length, failedPhones, flaggedPhones, { checked: WORDS.notes.numbersChecked, partly: WORDS.notes.numbersPartly, none: WORDS.notes.noNumbers, noun: "number" }),
    capability("message", "attachments", "unavailable", null, WORDS.notes.attachments),
  ];
  const signals: EvidenceSignal[] = [];
  if (input.signals.platformSwitch) signals.push({ id: "platform_switch", text: WORDS.signals.platform_switch });
  if (input.signals.newNumber) signals.push({ id: "new_number", text: WORDS.signals.new_number });
  if (input.signals.callbackNumber) signals.push({ id: "callback_number", text: fill(WORDS.signals.callback_number, { number: input.signals.callbackNumber }) });
  if (failedUrls) signals.push({ id: "links_unchecked", text: fill(WORDS.signals.links_unchecked, { count: String(failedUrls) }) });
  if (failedPhones) signals.push({ id: "numbers_unchecked", text: fill(WORDS.signals.numbers_unchecked, { count: String(failedPhones) }) });
  return newProfile({ type: "message", level, via, at: input.at, capabilities: caps, signals, simulated: input.simulated });
}
