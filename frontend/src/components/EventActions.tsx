// Actions available for a Patrol event. Enforces hardening rules:
// - Trust This only for growling-level uncertain items
// - Block offered for growling/barking; Biting only after verified block
// - Biting events can only be marked contained (acknowledged), not trusted

import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import type { PatrolEvent } from "@/src/domain/types";
import { contextFromEvent, gateForCategory, openHigginsHandoff, type HigginsOriginalEvidence } from "@/src/domain/higginsHandoff";
import { useApollo } from "@/src/store/ApolloContext";
import { spacing } from "@/src/theme";
import { Body, Button } from "./ui";

export function EventActions({ event, originalEvidence, hideAsk = false }: { event: PatrolEvent; originalEvidence?: HigginsOriginalEvidence[]; hideAsk?: boolean }) {
  const { blockEvent, trustEvent, resolveEvent } = useApollo();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const active = event.status === "active" || (event.status === "blocked" && !event.resolved_at);
  const wrap = (key: string, fn: () => Promise<unknown>) => async () => { setBusy(key); try { await fn(); } finally { setBusy(null); } };
  const askHiggins = () => openHigginsHandoff(router, { ...contextFromEvent(event, gateForCategory(event.category)), original_evidence: originalEvidence }, "Explain this issue and what I should do next.");

  if (!active) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Body>This event is {event.status === "trusted" ? "trusted (this exact link only)" : event.status === "blocked" ? "blocked and contained" : "handled"}.</Body>
        {hideAsk ? null : <Button testID="event-explain-button" variant="secondary" label="Ask Higgins to explain" onPress={askHiggins} />}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {event.state === "biting" ? (
        <Button testID="event-contained-button" label="Mark as contained" onPress={wrap("resolve", () => resolveEvent(event))} disabled={!!busy} />
      ) : (
        <>
          {(event.state === "barking" || event.state === "growling") && event.indicator_host ? (
            <Button testID="event-block-button" variant={event.state === "barking" ? "danger" : "warning"} label={busy === "block" ? "Blocking…" : "Block this destination"} onPress={wrap("block", () => blockEvent(event))} disabled={!!busy} />
          ) : null}
          {event.state === "growling" && event.trust_allowed ? (
            <Button testID="event-trust-button" variant="secondary" label="Trust this exact link" onPress={wrap("trust", () => trustEvent(event))} disabled={!!busy} />
          ) : null}
          <Button testID="event-handled-button" variant="ghost" label="Mark as handled" onPress={wrap("resolve", () => resolveEvent(event))} disabled={!!busy} />
        </>
      )}
      {hideAsk ? null : <Button testID="event-explain-button" variant="ghost" label="Ask Higgins to explain" onPress={askHiggins} />}
    </View>
  );
}
