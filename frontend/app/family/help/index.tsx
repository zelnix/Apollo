import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import MonitorUp from "lucide-react-native/icons/monitor-up";
import React from "react";
import { View } from "react-native";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { getFamilyHelpCapabilities } from "@/src/family-help/api";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { spacing, useTheme } from "@/src/theme";

export default function FamilyHelpOverview() {
  const router = useRouter(); const { colors } = useTheme(); const capability = useQuery({ queryKey: ["family-help-capabilities"], queryFn: getFamilyHelpCapabilities });
  const unavailable = capability.data?.enabled === false;
  return <FamilyHelpLayout><Card testID="family-help-overview-card" style={{ gap: spacing.lg }}><View style={{ alignItems: "center", gap: spacing.md }}><MonitorUp size={34} color={colors.brandPrimary} /><SectionTitle>Show your screen to someone you trust</SectionTitle></View><Body>You choose when sharing starts and stops. They can only watch — they cannot tap, type, hear audio, record through Apollo, or control your device.</Body>{unavailable ? <><Pill testID="family-help-unavailable-status" label="Not available yet" tone="neutral" /><Body testID="family-help-unavailable-message">Family Help is not available yet. Your other Apollo features still work.</Body></> : null}<Button testID="family-help-start-button" label={capability.isLoading ? "Checking availability…" : "Ask family for help"} disabled={!capability.data?.enabled} onPress={() => router.push("/family/help/start")} /></Card></FamilyHelpLayout>;
}