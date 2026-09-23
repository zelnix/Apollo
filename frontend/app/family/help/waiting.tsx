import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { getFamilyHelpSession, issueSignalingTicket } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { startNativeCapture } from "@/src/family-help/native";
import { spacing } from "@/src/theme";
export default function FamilyHelpWaiting() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>(); const router = useRouter(); const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId), refetchInterval: 2000 }); const session = query.data;
  const start = async () => { if (!session) return; const ticket = await issueSignalingTicket(session.sessionId); await startNativeCapture(session, ticket); router.replace({ pathname: "/family/help/active", params: { sessionId: session.sessionId } }); };
  return <FamilyHelpLayout title="Help request"><Card testID="family-help-waiting-card" style={{ gap: spacing.md }}><SectionTitle>{session?.state === "helper_accepted" ? `${session.helperDisplayName} accepted` : `Waiting for ${session?.helperDisplayName ?? "your helper"}`}</SectionTitle><Body>Sharing has not started. You will still approve Apple or Android’s screen-capture prompt.</Body>{session?.state === "helper_accepted" ? <Button testID="family-help-choose-share" label="Choose what to share" onPress={() => void start()} /> : null}</Card></FamilyHelpLayout>;
}