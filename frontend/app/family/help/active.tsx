import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { commandFamilyHelp, endFamilyHelpById, getFamilyHelpSession } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { reconcileNativeCapture } from "@/src/family-help/lifecycle";
import { getNativeFamilyHelpState, observeNativeFamilyHelp, pauseNative, resumeNative, stopNative } from "@/src/family-help/native";
import { captureControlFor } from "@/src/family-help/stateMachine";
import { spacing } from "@/src/theme";

export default function ActiveFamilyHelp() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>(); const router = useRouter();
  const [expected, setExpected] = useState<"active" | "paused" | null>(null); const [controlError, setControlError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId), refetchInterval: 1000 }); const session = query.data;
  const extend = useMutation({ mutationFn: () => commandFamilyHelp(session!, "extend"), onSuccess: () => { void query.refetch(); } });
  const reconcile = useCallback(async () => { if (!sessionId) return; await reconcileNativeCapture(sessionId, await getNativeFamilyHelpState()); await query.refetch(); }, [query, sessionId]);
  useEffect(() => { const subscription = observeNativeFamilyHelp(() => { void reconcile(); }); return () => subscription.remove(); }, [reconcile]);
  useEffect(() => { if (expected && session?.state === expected) { setExpected(null); setControlError(null); } }, [expected, session?.state]);
  useEffect(() => { if (!expected) return; const timer = setTimeout(() => { setExpected(null); setControlError("Apollo kept sharing in the safest available state. Check the status and try again."); void reconcile(); }, 5000); return () => clearTimeout(timer); }, [expected, reconcile]);
  useEffect(() => { if (session && ["ended", "expired", "revoked", "failed"].includes(session.state)) void stopNative(session).catch(() => undefined); }, [session]);
  const control = async () => {
    if (!session) return; const nativeControl = captureControlFor(session.state); if (!nativeControl) return;
    const next = nativeControl === "pause" ? "paused" : "active"; setExpected(next); setControlError(null);
    try { if (nativeControl === "pause") await pauseNative(session); else await resumeNative(session); }
    catch { setExpected(null); setControlError("The native screen-sharing control failed. Apollo did not claim the state changed."); }
  };
  const stop = async () => { if (!session) return; await stopNative(session).catch(() => undefined); await endFamilyHelpById(session.sessionId).catch(() => undefined); router.replace("/family"); };
  const label = session?.state === "paused" ? "Paused" : session?.state === "active" ? "Sharing is on" : "Connecting securely";
  return <FamilyHelpLayout title="Screen sharing"><Card testID="family-help-active-card" style={{ gap: spacing.md }}><Pill testID="family-help-active-status" label={label} tone={session?.state === "active" ? "resting" : "neutral"} /><SectionTitle>{session?.helperDisplayName ?? "Your helper"} can view only while this status says sharing is on</SectionTitle><Body>They cannot control your device. Stop before opening passwords, payment details, private messages, health information, photos, or one-time codes.</Body><View style={{ gap: spacing.sm }}><Button testID="family-help-pause-resume" label={session?.state === "paused" ? "Continue sharing" : "Pause sharing"} disabled={!session || !["active", "paused"].includes(session.state) || !!expected} onPress={() => void control()} /><Button testID="family-help-extend" label="Add 30 minutes" variant="secondary" disabled={!session || !["active", "paused"].includes(session.state)} onPress={() => extend.mutate()} /><Button testID="family-help-stop" label="Stop sharing" variant="danger" disabled={!session} onPress={() => void stop()} />{controlError ? <Body testID="family-help-control-error">{controlError}</Body> : null}</View></Card></FamilyHelpLayout>;
}