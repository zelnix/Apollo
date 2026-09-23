import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { commandFamilyHelp, endFamilyHelp, getFamilyHelpSession } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { stopNative } from "@/src/family-help/native";
import { spacing } from "@/src/theme";
export default function ActiveFamilyHelp() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>(); const router = useRouter();
  const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId), refetchInterval: 2000 }); const session = query.data;
  const command = useMutation({ mutationFn: (action: "pause" | "resume" | "extend") => commandFamilyHelp(session!, action), onSuccess: () => { void query.refetch(); } });
  const stop = async () => { if (!session) return; await stopNative(session).catch(() => undefined); await endFamilyHelp(session).catch(() => undefined); router.replace("/family"); };
  return <FamilyHelpLayout title="Screen sharing"><Card testID="family-help-active-card" style={{ gap: spacing.md }}><Pill testID="family-help-active-status" label={session?.state === "paused" ? "Paused" : "Sharing is on"} tone={session?.state === "paused" ? "neutral" : "resting"} /><SectionTitle>{session?.helperDisplayName ?? "Your helper"} can view your screen</SectionTitle><Body>They cannot control your device. Stop before opening passwords, payment details, private messages, health information, photos, or one-time codes.</Body><View style={{ gap: spacing.sm }}><Button testID="family-help-pause-resume" label={session?.state === "paused" ? "Continue sharing" : "Pause sharing"} disabled={!session} onPress={() => command.mutate(session?.state === "paused" ? "resume" : "pause")} /><Button testID="family-help-extend" label="Add 30 minutes" variant="secondary" disabled={!session} onPress={() => command.mutate("extend")} /><Button testID="family-help-stop" label="Stop sharing" variant="danger" disabled={!session} onPress={() => void stop()} /></View></Card></FamilyHelpLayout>;
}