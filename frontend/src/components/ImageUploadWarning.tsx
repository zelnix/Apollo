// The one informational warning shown before an image is uploaded for investigation.
// Not a privacy gate: no choices beyond Continue / Cancel, and nothing is recorded.
import React from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";

import { Body, Button } from "@/src/components/ui";
import { simulation } from "@/src/simulation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export const IMAGE_UPLOAD_WARNING = {
  title: "Before you upload",
  body: [
    "Check that the image doesn't contain personal, medical or financial information about you that you don't want to share for this investigation.",
    "Apollo keeps information that may be important evidence. Passwords, PINs, verification codes and similar credentials are protected where Apollo can detect them.",
    "Only upload the image if you're comfortable using its contents for this investigation.",
  ],
};

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.xl },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  error: { fontFamily: fonts.textMedium, fontSize: 15, lineHeight: 21, color: c.onSurface },
  notice: {
    borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.gold,
    backgroundColor: c.surfaceSecondary, padding: spacing.md, gap: spacing.xs,
  },
  tag: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.gold },
  tagText: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.5, color: "#1B2437" },
  noticeText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
}));

export function ImageUploadWarning({ visible, onContinue, onCancel, onCrop, busyLabel, error, notice, onRetry, testID = "image-upload-warning" }: {
  visible: boolean;
  onContinue: () => void;
  onCancel: () => void;
  /** When provided, a Crop button lets the user keep only part of the image. */
  onCrop?: () => void;
  /** Shown instead of the actions while the image is being prepared or sent. */
  busyLabel?: string | null;
  /** Shown instead of the warning when preparing/sending failed. */
  error?: string | null;
  /** Preview builds only: says plainly that the on-device read was simulated. */
  notice?: string | null;
  onRetry?: () => void;
  testID?: string;
}) {
  const s = useStyles(); const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={busyLabel ? undefined : onCancel} accessibilityLabel="Close">
        <Pressable style={s.card} testID={testID} onPress={() => undefined}>
          <Text style={s.title} accessibilityRole="header">{error ? "Image not sent" : IMAGE_UPLOAD_WARNING.title}</Text>
          {notice ? (
            <View style={s.notice} testID={`${testID}-notice`}>
              <View style={s.tag}><Text style={s.tagText}>{simulation.tag}</Text></View>
              <Text style={s.noticeText}>{notice}</Text>
            </View>
          ) : null}
          {error ? <Text style={s.error} testID={`${testID}-error`}>{error}</Text> : IMAGE_UPLOAD_WARNING.body.map((p) => <Body key={p}>{p}</Body>)}
          {busyLabel ? (
            <View style={[s.actions, { alignItems: "center" }]}><ActivityIndicator color={colors.brand} /><Body>{busyLabel}</Body></View>
          ) : (
            <View style={s.actions}>
              <View style={{ flex: 1 }}><Button testID={`${testID}-cancel`} variant="secondary" label="Cancel" onPress={onCancel} /></View>
              {onCrop && !error ? <View style={{ flex: 1 }}><Button testID={`${testID}-crop`} variant="secondary" label="Crop" onPress={onCrop} /></View> : null}
              {error && !onRetry ? null : (
                <View style={{ flex: 1 }}><Button testID={`${testID}-continue`} label={error ? "Retry" : "Continue"} onPress={error ? onRetry! : onContinue} /></View>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
