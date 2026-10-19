import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { getFamilyHelpSession, respondFamilyHelpSession } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { useApollo } from "@/src/store/ApolloContext";
import { spacing } from "@/src/theme";
export default function JoinFamilyHelp() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>(); const router = useRouter(); const { deviceId } = useApollo();
  const query = useQuery({ queryKey: ["family-help-session", sessionId], queryFn: () => getFamilyHelpSession(sessionId) }); const session = query.data;
  const respond = useMutation({ mutationFn: (decision: "accept" | "decline") => respondFamilyHelpSession(session!, deviceId!, decision), onSuccess: (row, decision) => { if (decision === "accept") router.replace({ pathname: "/family/help/view", params: { sessionId: row.sessionId } }); else router.replace("/family"); } });
  return <FamilyHelpLayout title="Help request"><Card testID="family-help-join-card" style={{ gap: spacing.md }}><SectionTitle>{session?.ownerDisplayName ?? "A family member"} is asking for help</SectionTitle><Body>They may choose to share their screen. You can only watch. You cannot tap, type, hear audio, record through Apollo, or control their device.</Body><Button testID="family-help-accept" label="I can help" disabled={!session || !deviceId} onPress={() => respond.mutate("accept")} /><Button testID="family-help-decline" label="Not now" variant="secondary" disabled={!session || !deviceId} onPress={() => respond.mutate("decline")} /></Card></FamilyHelpLayout>;
}