import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { endFamilyHelpById, getFamilyHelpSession, issueSignalingTicket } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { reconcileNativeCapture } from "@/src/family-help/lifecycle";
import { getNativeFamilyHelpState, observeNativeFamilyHelp, startNativeCapture, stopNativeByIdentity } from "@/src/family-help/native";
import { spacing } from "@/src/theme";

export default function FamilyHelpWaiting() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [captureRequested, setCaptureRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId), refetchInterval: 1000 });
  const session = query.data;
  const reconcile = useCallback(async () => {
    if (!sessionId || !captureRequested) return;
    const row = await reconcileNativeCapture(sessionId, await getNativeFamilyHelpState());
    if (row.state === "active") router.replace({ pathname: "/family/help/active", params: { sessionId } });
    if (["ended", "expired", "revoked", "failed"].includes(row.state)) setError("Screen sharing did not start. No screen image is being shared.");
    await query.refetch();
  }, [captureRequested, query, router, sessionId]);
  useEffect(() => {
    const subscription = observeNativeFamilyHelp(() => { void reconcile(); });
    const timer = captureRequested ? setInterval(() => { void reconcile(); }, 750) : null;
    return () => { subscription.remove(); if (timer) clearInterval(timer); };
  }, [captureRequested, reconcile]);
  const generation = session?.generation;
  useEffect(() => {
    if (!captureRequested || !sessionId || !generation) return;
    const timer = setTimeout(() => {
      void stopNativeByIdentity(sessionId, generation).catch(() => undefined); void endFamilyHelpById(sessionId).catch(() => undefined);
      setError("Screen sharing approval timed out. No screen image is being shared."); setCaptureRequested(false);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [captureRequested, generation, sessionId]);
  const start = async () => {
    if (!session) return;
    setError(null); setCaptureRequested(true);
    try { const ticket = await issueSignalingTicket(session.sessionId); await startNativeCapture(session, ticket); await reconcile(); }
    catch { setError("Apollo could not start screen sharing. No screen image is being shared."); await reconcile().catch(() => undefined); }
  };
  const accepted = session?.state === "helper_accepted";
  return <FamilyHelpLayout title="Help request"><Card testID="family-help-waiting-card" style={{ gap: spacing.md }}><Pill testID="family-help-waiting-status" label={captureRequested ? "Waiting for system approval" : accepted ? "Helper ready" : "Invitation sent"} tone="neutral" /><SectionTitle>{accepted ? `${session.helperDisplayName} accepted` : captureRequested ? "Approve sharing in the system prompt" : `Waiting for ${session?.helperDisplayName ?? "your helper"}`}</SectionTitle><Body>Sharing is off until the native capture starts and Apollo confirms the private helper connection.</Body>{accepted && !captureRequested ? <Button testID="family-help-choose-share" label="Choose what to share" onPress={() => void start()} /> : null}{error ? <Body testID="family-help-start-error">{error}</Body> : null}</Card></FamilyHelpLayout>;
}