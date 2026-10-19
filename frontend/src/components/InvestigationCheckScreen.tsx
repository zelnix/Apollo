// InvestigationCheckScreen — Full-screen investigation result presentation.
// This is the screen shown for investigation checks (messages, links, screenshots, etc.).
// It manages the Magnum DI investigation lifecycle directly, without Gate abstraction.
//
// Architecture: Submit -> Apollo privacy protection -> Magnum DI investigation -> this screen.
// CheckResultScreen handles deterministic/device results; this handles investigation results.
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvestigationFlow } from "@/src/components/InvestigationFlow";
import { Button } from "@/src/components/ui";
import type { CheckResultModel } from "@/src/domain/checkResult";
import type { HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  checkType: {
    fontFamily: fonts.textMedium,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    marginTop: 2,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    paddingBottom: spacing["3xl"],
  },
  secondary: { gap: spacing.sm },
}));

export interface InvestigationCheckScreenProps {
  /** Static check result model — used for header info (gate name, check type). */
  result: CheckResultModel;
  /** Higgins issue context for the investigation. */
  investigationContext: HigginsIssueContext;
  /** Natural-language question for the investigation. */
  investigationQuestion: string;
  /** Stable submission ID for the check. */
  submissionId: string;
  /** Patrol event ID to link the investigation to. */
  eventId?: string | null;
  /** Optional action buttons below the investigation. */
  actions?: {
    label: string;
    onPress: () => void;
    testID: string;
    variant?: "primary" | "secondary" | "ghost";
  }[];
  /** Optional close override — defaults to goBackOrHome. */
  onClose?: () => void;
}

export function InvestigationCheckScreen({
  result,
  investigationContext,
  investigationQuestion,
  submissionId,
  eventId,
  actions = [],
  onClose,
}: InvestigationCheckScreenProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const close = () => (onClose ? onClose() : goBackOrHome(router));

  return (
    <View style={s.root} testID="investigation-check-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{result.gate}</Text>
          <Text style={s.checkType}>{result.checkType}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
          style={s.close}
          testID="investigation-check-close"
        >
          <X size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + spacing["3xl"] },
        ]}
        testID="investigation-check-scroll"
      >
        <InvestigationFlow
          submissionId={submissionId}
          context={investigationContext}
          question={investigationQuestion}
          testID="investigation-check-flow"
          autoStart
          eventId={eventId}
        />

        {actions.length > 0 ? (
          <View style={s.secondary}>
            {actions.map((a) => (
              <Button
                key={a.testID}
                testID={a.testID}
                label={a.label}
                variant={a.variant ?? "ghost"}
                onPress={a.onPress}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
