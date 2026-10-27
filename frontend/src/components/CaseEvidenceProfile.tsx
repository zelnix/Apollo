// The case's evidence card on the Threat case screen, with "Add the original email (.eml)" while the evidence is
// below the original message. The original is read on this phone and re-triaged in THIS case; its history stays.
import React, { useState } from "react";

import { EvidenceProfileCard } from "@/src/components/EvidenceProfileCard";
import { EMAIL_WORDS } from "@/src/domain/triage/emailEvidence";
import type { PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { pickOriginalEmail } from "@/src/store/originalEmail";

export function CaseEvidenceProfile({ event }: { event: PatrolEvent }) {
  const { checkEmail, showToast } = useApollo();
  const [busy, setBusy] = useState(false);
  const profile = event.evidence_profile;
  if (!profile) return null;

  const addOriginal = async () => {
    setBusy(true);
    try {
      const original = await pickOriginalEmail();
      if (!original) return;
      const outcome = await checkEmail({ from: "", subject: "", raw: "", via: "eml_file", original, upgradeEventId: event.event_id });
      showToast(outcome.upgradeMismatch ? EMAIL_WORDS.upgradeMismatch
        : `Evidence is now ${outcome.profile.label}. Higgins Triage re-checked this case with it.`, "neutral");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "ApolloSG couldn't read that email file.", "growling");
    } finally { setBusy(false); }
  };

  return <EvidenceProfileCard profile={profile} onAddOriginal={event.category === "email" ? () => void addOriginal() : undefined} busy={busy} testID="tc-evidence-profile" />;
}
