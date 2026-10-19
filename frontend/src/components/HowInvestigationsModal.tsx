/**
 * HowInvestigationsModal — Educational popup explaining how Apollo Scam Guard
 * detects, investigates, assesses and handles potential threats.
 *
 * Opened from the "How investigations work" button on the Threats hero card.
 * Pure presentation — no backend calls, no state changes, no navigation.
 */
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Shield from "lucide-react-native/icons/shield";
import Search from "lucide-react-native/icons/search";
import MessageSquare from "lucide-react-native/icons/message-square";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import FileText from "lucide-react-native/icons/file-text";
import Heart from "lucide-react-native/icons/heart";
import X from "lucide-react-native/icons/x";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Step data ───────────────────────────────────────────────────────────────

interface Step {
  number: string;
  title: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  iconBg: string;
  paragraphs: string[];
  bullets?: string[];
}

const STEPS: Step[] = [
  {
    number: "1",
    title: "Apollo detects",
    icon: Shield,
    iconBg: "#E8F5EE",
    paragraphs: [
      "Apollo identifies potential threats through the protection capabilities available on your device, or when you submit something for checking.",
      "Not every detection is a confirmed threat. A finding may need further investigation.",
    ],
  },
  {
    number: "2",
    title: "Magnum DI investigates",
    icon: Search,
    iconBg: "#E8EDF6",
    paragraphs: [
      "Magnum DI examines the available evidence and relevant information sources to assess the potential threat.",
      "Depending on the case, this may include checking websites, messages, business details, reported claims or other relevant evidence.",
      "Only checks that were actually performed are described. If evidence or a source is unavailable, the investigation says so rather than implying verification.",
    ],
  },
  {
    number: "3",
    title: "Higgins explains",
    icon: MessageSquare,
    iconBg: "rgba(201,163,74,0.14)",
    paragraphs: [
      "Higgins turns the investigation findings into clear, practical guidance.",
      "You should be able to understand:",
    ],
    bullets: [
      "What was found.",
      "Why it matters.",
      "What evidence supports the assessment.",
      "Whether you need to do anything.",
    ],
  },
  {
    number: "4",
    title: "The case is tracked",
    icon: ClipboardList,
    iconBg: "#F5F0DC",
    paragraphs: [
      "Each recorded investigation has a status reflecting its actual state.",
    ],
    bullets: [
      "Needs action \u2014 A specific user action is required.",
      "Under review \u2014 The investigation remains unresolved or further assessment is in progress.",
      "Handled \u2014 The recorded issue has been dealt with or the required action has been completed.",
    ],
  },
  {
    number: "5",
    title: "You can review the findings",
    icon: FileText,
    iconBg: "#E8EDF6",
    paragraphs: [
      "Select a case under Recent Threat Investigations to open its Threat Case details.",
      "Review the evidence, Higgins\u2019 explanation and the recommended next steps. Where action is required, Higgins provides one clear primary action with direct navigation to the relevant screen when supported.",
    ],
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function HowInvestigationsModal({ visible, onClose }: Props) {
  const s = useStyles();
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      testID="how-investigations-modal"
    >
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Close button */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [s.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <X size={20} color={colors.onSurfaceSecondary} />
          </Pressable>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Title */}
            <Text style={s.title}>How investigations work</Text>

            {/* Introduction */}
            <Text style={s.intro}>
              Apollo looks for potential threats. When something needs closer examination, Magnum DI investigates the available evidence. Higgins explains the findings and guides you through any necessary action.
            </Text>

            {/* Steps */}
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <View key={step.number} style={s.stepContainer}>
                  {/* Step header */}
                  <View style={s.stepHeader}>
                    <View style={[s.stepIconWrap, { backgroundColor: step.iconBg }]}>
                      <Icon size={18} color={colors.onSurface} />
                    </View>
                    <View style={s.stepTitleWrap}>
                      <Text style={s.stepLabel}>Step {step.number}</Text>
                      <Text style={s.stepTitle}>{step.title}</Text>
                    </View>
                  </View>

                  {/* Body paragraphs */}
                  {step.paragraphs.map((p, i) => (
                    <Text key={i} style={s.stepBody}>{p}</Text>
                  ))}

                  {/* Bullets */}
                  {step.bullets ? (
                    <View style={s.bulletList}>
                      {step.bullets.map((b, i) => (
                        <View key={i} style={s.bulletRow}>
                          <Text style={s.bulletDot}>{"\u2022"}</Text>
                          <Text style={s.bulletText}>{b}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {/* Separator */}
            <View style={s.divider} />

            {/* Closing message */}
            <View style={s.closingSection}>
              <View style={s.stepHeader}>
                <View style={[s.stepIconWrap, { backgroundColor: "rgba(79,175,131,0.15)" }]}>
                  <Heart size={18} color="#1B6B47" />
                </View>
                <Text style={s.closingHeading}>You stay in control</Text>
              </View>
              <Text style={s.stepBody}>
                Apollo provides protection where its capabilities are available. Magnum DI investigates potential threats, and Higgins helps you understand the findings and decide what to do next.
              </Text>
            </View>

            {/* Got it button */}
            <Pressable
              testID="how-investigations-got-it"
              accessibilityRole="button"
              accessibilityLabel="Got it"
              onPress={onClose}
              style={({ pressed }) => [
                s.gotItBtn,
                { backgroundColor: colors.brand, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={s.gotItText}>Got it</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    width: "100%",
    maxHeight: "85%",
    overflow: "hidden",
  },
  closeBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: spacing["2xl"],
    paddingTop: spacing["2xl"] + 8,
    gap: spacing.lg,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 28,
    color: c.onSurface,
    paddingRight: 36,
  },
  intro: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurfaceSecondary,
  },

  // Steps
  stepContainer: {
    gap: spacing.sm,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepTitleWrap: {
    flex: 1,
    gap: 1,
  },
  stepLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 11,
    color: c.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stepTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 21,
    color: c.onSurface,
  },
  stepBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 21,
    color: c.onSurfaceSecondary,
  },

  // Bullets
  bulletList: {
    gap: 6,
    paddingLeft: 4,
  },
  bulletRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  bulletDot: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    color: c.brand,
    marginTop: 1,
  },
  bulletText: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 21,
    color: c.onSurfaceSecondary,
    flex: 1,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: c.border,
    marginVertical: spacing.xs,
  },

  // Closing
  closingSection: {
    gap: spacing.sm,
  },
  closingHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 21,
    color: c.onSurface,
    flex: 1,
  },

  // Got it button
  gotItBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  gotItText: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: "#FFFFFF",
  },
}));
