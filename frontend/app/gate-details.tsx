// Gate Details — reusable screen for individual Gate information.
// Navigated to from Protection Category → Gates tab → Gate row.
// Shows: Gate name, status, what it does, how it works, current status,
// coverage & limitations, and Higgins guidance.

import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Info from "lucide-react-native/icons/info";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useMemo } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Pill } from "@/src/components/ui";
import type { GateId, GatePresentation } from "@/src/domain/gates";
import { gateTone } from "@/src/domain/gates";
import { GATE_CONTENT } from "@/src/domain/gateContent";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// ── Gate icon mapping ───────────────────────────────────────────────────────
const GATE_ICONS: Record<
  GateId,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  site: ShieldCheck,
  link: Link2,
  text: MessageSquare,
  call: Phone,
  email: Mail,
  account: ShieldCheck,
  file: FileText,
  app: Grid2x2,
  device: Smartphone,
  network: Wifi,
};

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: c.onSurface,
  },

  // Status area
  statusArea: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  modeLabel: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  currentHelp: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },

  // Scroll content
  scrollContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    paddingBottom: spacing["3xl"],
  },

  // Section cards
  sectionCard: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
  },
  sectionBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 21,
    color: c.onSurfaceSecondary,
  },

  // Bullets
  bullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingLeft: spacing.xs,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },

  // Current status card
  statusCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusCardTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.onSurface,
  },
  statusCardBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },
  limitationText: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
  },

  // Higgins card
  higginsCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  higginsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  higginsAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: c.surfaceTertiary,
    flexShrink: 0,
  },
  higginsAvatar: { width: 44, height: 44 },
  higginsTitleBlock: { flex: 1, gap: 2 },
  higginsTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.onSurface,
  },
  higginsSub: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  higginsBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurface,
  },
  learnBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    minHeight: 44,
  },
  learnBtnText: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function getModeLabel(gate: GatePresentation): string {
  const auto = gate.capability.automatic;
  const od = gate.capability.onDemand;
  if (auto && !auto.manualOnly && od) return "Automatic + on-demand";
  if (auto && !auto.manualOnly) return "Automatic protection";
  if (od) return "On-demand check";
  return "Manual check";
}

function getStatusExplanation(gate: GatePresentation): string {
  const auto = gate.capability.automatic;
  switch (gate.statusLabel) {
    case "Watching":
      return "This Gate is actively protecting your device. It is verified, running and monitoring in the background within its supported scope.";
    case "Manual check":
      return "This Gate is ready for you to use whenever you need it. Submit something to check and Apollo will analyse it.";
    case "Check in progress":
      return "Apollo is currently verifying this Gate's status. This usually completes quickly.";
    case "Setup required":
      return auto?.state === "permission_needed"
        ? "This Gate needs a device permission to operate. Grant it whenever you're ready — your other protections remain active."
        : "This Gate needs initial setup before it can protect automatically.";
    case "Off":
      return "This Gate has been turned off by choice. You can re-enable it at any time.";
    case "Limited":
      return "This Gate is running but with reduced coverage. Some protection capabilities are restricted by device settings or configuration.";
    case "Action needed":
      return "This Gate was active but has encountered a problem and is not currently protecting. It needs your attention to resume.";
    case "Unavailable":
      return "This Gate is not available on this device or platform. This may be due to operating system restrictions.";
    case "Unable to verify":
      return "Apollo cannot currently confirm whether this Gate is operating. It may still be working, but verification has not completed recently.";
    default:
      return gate.currentHelp;
  }
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function GateDetailsScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useProtectionHealth();
  const params = useLocalSearchParams<{ gate?: string; category?: string }>();

  const gateId = (params.gate ?? "site") as GateId;
  const categoryId = params.category ?? "websites_links";

  // Find the gate from health store
  const gate = useMemo(() => {
    if (health.checking) return null;
    return health.gates.find((g) => g.id === gateId) ?? null;
  }, [health.checking, health.gates, gateId]);

  const content = GATE_CONTENT[gateId];
  const Icon = GATE_ICONS[gateId] ?? ShieldCheck;

  // Loading / not found
  if (health.checking || !gate) {
    return (
      <View style={s.root} testID="gate-details-screen">
        <View style={{ paddingTop: insets.top + spacing.md }}>
          <View style={s.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="gate-details-back"
              onPress={() => goBackOrHome(router)}
              style={s.backBtn}
            >
              <ChevronLeft size={24} color={colors.onSurface} />
            </Pressable>
            <Text style={s.headerTitle}>Gate Details</Text>
          </View>
        </View>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.xl,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.text,
              fontSize: 15,
              color: colors.onSurfaceSecondary,
              textAlign: "center",
            }}
          >
            {health.checking
              ? "Checking protection status…"
              : "Gate not found."}
          </Text>
        </View>
      </View>
    );
  }

  const tone = gateTone(gate.tone);
  const modeLabel = getModeLabel(gate);
  const statusExplanation = getStatusExplanation(gate);
  const hasLimitation = !!gate.capability.automatic?.limitation;

  const askPrompt = `Tell me about my ${gate.title} protection. Its current status is "${gate.statusLabel}". ${gate.currentHelp} What does this Gate do, how does it work, and is there anything I should do?`;

  return (
    <View style={s.root} testID="gate-details-screen">
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={s.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Gates"
            testID="gate-details-back"
            onPress={() =>
              router.push(
                `/protection-details?category=${categoryId}` as never,
              )
            }
            style={s.backBtn}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>
            {gate.title}
          </Text>
        </View>

        {/* Status + mode */}
        <View style={s.statusArea}>
          <View style={s.statusRow}>
            <Pill tone={tone} label={gate.statusLabel} />
            <Text style={s.modeLabel}>{modeLabel}</Text>
          </View>
          <Text style={s.currentHelp}>{gate.currentHelp}</Text>
        </View>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        testID="gate-details-scroll"
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + spacing["3xl"], paddingTop: spacing.sm },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* What this Gate does */}
        <Card style={s.sectionCard} testID="gate-what-it-does">
          <View style={s.sectionHeader}>
            <View
              style={[
                s.sectionIcon,
                { backgroundColor: colors.surfaceTertiary },
              ]}
            >
              <Icon size={18} color={colors.brand} />
            </View>
            <Text style={s.sectionTitle}>What this Gate does</Text>
          </View>
          <Text style={s.sectionBody}>{content.whatItDoes}</Text>
        </Card>

        {/* How this Gate works */}
        <Card style={s.sectionCard} testID="gate-how-it-works">
          <View style={s.sectionHeader}>
            <View
              style={[
                s.sectionIcon,
                { backgroundColor: "rgba(22,34,53,0.12)" },
              ]}
            >
              <Info size={18} color={colors.brand} />
            </View>
            <Text style={s.sectionTitle}>How this Gate works</Text>
          </View>
          {content.howItWorks.map((bullet, i) => (
            <View key={i} style={s.bullet}>
              <View
                style={[s.bulletDot, { backgroundColor: colors.brand }]}
              />
              <Text style={s.bulletText}>{bullet}</Text>
            </View>
          ))}
        </Card>

        {/* Current protection status */}
        <Card style={s.sectionCard} testID="gate-current-status">
          <View style={s.sectionHeader}>
            <View
              style={[
                s.sectionIcon,
                {
                  backgroundColor:
                    gate.tone === "action"
                      ? "rgba(211,47,47,0.10)"
                      : gate.tone === "good"
                        ? "rgba(46,125,50,0.10)"
                        : colors.surfaceTertiary,
                },
              ]}
            >
              {gate.tone === "action" ? (
                <TriangleAlert size={18} color={colors.barkingText} />
              ) : (
                <ShieldCheck
                  size={18}
                  color={
                    gate.tone === "good" ? colors.restingText : colors.brand
                  }
                />
              )}
            </View>
            <Text style={s.sectionTitle}>Current protection status</Text>
          </View>
          <Text style={s.sectionBody}>{statusExplanation}</Text>

          {hasLimitation ? (
            <View
              style={[
                s.statusCard,
                { backgroundColor: "rgba(230,138,0,0.08)" },
              ]}
            >
              <Text style={s.statusCardTitle}>Current limitation</Text>
              <Text
                style={[
                  s.limitationText,
                  { color: colors.ears_upText },
                ]}
              >
                {gate.capability.automatic?.limitation}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Coverage */}
        <Card style={s.sectionCard} testID="gate-coverage">
          <View style={s.sectionHeader}>
            <View
              style={[
                s.sectionIcon,
                { backgroundColor: colors.surfaceTertiary },
              ]}
            >
              <Globe size={18} color={colors.brand} />
            </View>
            <Text style={s.sectionTitle}>What it protects</Text>
          </View>
          {content.coverage.map((bullet, i) => (
            <View key={i} style={s.bullet}>
              <View
                style={[s.bulletDot, { backgroundColor: colors.restingText }]}
              />
              <Text style={s.bulletText}>{bullet}</Text>
            </View>
          ))}
        </Card>

        {/* Limitations */}
        <Card style={s.sectionCard} testID="gate-limitations">
          <View style={s.sectionHeader}>
            <View
              style={[
                s.sectionIcon,
                { backgroundColor: "rgba(230,138,0,0.08)" },
              ]}
            >
              <TriangleAlert size={18} color={colors.ears_upText} />
            </View>
            <Text style={s.sectionTitle}>Limitations</Text>
          </View>
          {content.limitations.map((bullet, i) => (
            <View key={i} style={s.bullet}>
              <View
                style={[
                  s.bulletDot,
                  { backgroundColor: colors.ears_upText },
                ]}
              />
              <Text style={s.bulletText}>{bullet}</Text>
            </View>
          ))}
        </Card>

        {/* Higgins guidance */}
        <View
          style={[s.higginsCard, { backgroundColor: colors.surfaceTertiary }]}
          testID="gate-higgins-guidance"
        >
          <View style={s.higginsHeader}>
            <View style={s.higginsAvatarWrap}>
              <Image source={higginsAvatar} style={s.higginsAvatar} />
            </View>
            <View style={s.higginsTitleBlock}>
              <Text style={s.higginsTitle}>
                Need help with {gate.title}?
              </Text>
              <Text style={s.higginsSub}>
                Higgins can explain this Gate in detail.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask Higgins about ${gate.title}`}
            testID="gate-ask-higgins"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/ask",
                params: { prompt: askPrompt },
              })
            }
            style={({ pressed }) => [
              s.learnBtn,
              {
                backgroundColor: colors.gold,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text style={[s.learnBtnText, { color: colors.onBrand }]}>
              Ask Higgins
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
