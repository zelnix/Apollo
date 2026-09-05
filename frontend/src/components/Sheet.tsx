// Lightweight bottom sheet built on Modal (no extra native deps).

import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: c.border, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginTop: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: c.onSurface, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.md },
}));

export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn} style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} testID="sheet-backdrop" accessibilityLabel="Close" />
        <Animated.View entering={SlideInDown} style={s.sheet} testID={testID}>
          <View style={s.handle} />
          <Text style={s.title}>{title}</Text>
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}>{children}</ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
