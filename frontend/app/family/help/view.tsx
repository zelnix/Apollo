import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { FamilyAssistViewer } from "@/modules/apollo-family-assist";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { endFamilyHelp, getFamilyHelpSession, issueSignalingTicket } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { startNativeViewer } from "@/src/family-help/native";
import { radius, spacing, useTheme } from "@/src/theme";
export default function ViewFamilyHelp() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>(); const router = useRouter(); const { colors } = useTheme(); const [started, setStarted] = useState(false);
  const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId), refetchInterval: 2000 }); const session = query.data;
  useEffect(() => { if (!session || started) return; setStarted(true); void issueSignalingTicket(session.sessionId).then((ticket) => startNativeViewer(session, ticket)); }, [session, started]);
  const leave = async () => { if (session) await endFamilyHelp(session).catch(() => undefined); router.replace("/family"); };
  const paused = session?.state === "paused";
  return <FamilyHelpLayout title="Helping family"><Card testID="family-help-viewer-card" style={{ gap: spacing.md }}><Pill testID="family-help-viewer-status" label={paused ? "Sharing paused" : "View only"} tone="neutral" /><SectionTitle>{session?.ownerDisplayName ?? "Your family member"} is sharing</SectionTitle><View testID="family-help-native-viewer" style={{ height: 300, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary }}>{paused ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl }}><Body testID="family-help-paused-message">They paused sharing. No screen image is shown.</Body></View> : <FamilyAssistViewer style={{ flex: 1 }} />}</View><Body>You can only watch. Ask them before they open anything private.</Body><Button testID="family-help-leave" label="Leave session" variant="secondary" onPress={() => void leave()} /></Card></FamilyHelpLayout>;
}