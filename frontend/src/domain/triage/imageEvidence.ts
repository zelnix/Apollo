// Image evidence — what ApolloSG could take from a picture: the text it read on the phone and the links, numbers and
// codes in it. A picture shows what was on screen, not where it came from; its metadata is removed on the phone
// before anything is sent and is never used as evidence. Pure, no Expo imports.

import { capability, fill, newProfile, typeWords, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type ImageVia = "photo" | "library" | "shared";

const WORDS = typeWords("image") as ReturnType<typeof typeWords> & { notes: Record<string, string>; signals: Record<string, string> };

export function buildImageProfile(input: { via: ImageVia; textRead: boolean; identifiers: number; flagged: number; redacted: boolean; at?: string }): EvidenceProfile {
  const signals: EvidenceSignal[] = [];
  if (input.redacted) signals.push({ id: "redacted", text: WORDS.signals.redacted });
  if (input.flagged) signals.push({ id: "flagged", text: fill(WORDS.signals.flagged, { count: String(input.flagged) }) });
  return newProfile({
    type: "image", level: "image", via: input.via, at: input.at,
    capabilities: [
      capability("image", "image_content", "observed", input.textRead ? "Text read" : "No text found", input.textRead ? WORDS.notes.content : WORDS.notes.noText),
      capability("image", "metadata", "unavailable", null, WORDS.notes.metadata),
      capability("image", "source", "observed", typeWords("image").via?.[input.via] ?? input.via, WORDS.notes.source),
      input.identifiers
        ? capability("image", "embedded_identifiers", "recorded", `${input.identifiers} found${input.flagged ? `, ${input.flagged} flagged` : ""}`, WORDS.notes.identifiers)
        : capability("image", "embedded_identifiers", "observed", "None found", WORDS.notes.identifiers),
    ],
    signals,
  });
}
