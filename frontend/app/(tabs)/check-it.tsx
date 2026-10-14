// Check screen — Apollo's security toolbox.
// Matches approved visual mockup exactly: tinted section containers,
// white cards, 2-column and 3-column grids, section-specific backgrounds.

import Bookmark from "lucide-react-native/icons/bookmark";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileSearch from "lucide-react-native/icons/file-search";
import KeyRound from "lucide-react-native/icons/key-round";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import PhoneIncoming from "lucide-react-native/icons/phone-incoming";
import ScanLine from "lucide-react-native/icons/scan-line";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import Wifi from "lucide-react-native/icons/wifi";
import React from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// ── Types ───────────────────────────────────────────────────────────────────

type IconComponent = React.ComponentType<{ size?: number; color?: string }>;

interface CheckCard {
  id: string;
  label: string;
  description: string;
  icon: IconComponent;
  route: string;
  accessibilityHint: string;
}

// ── Section backgrounds & icon tints ────────────────────────────────────────

const SECTION_BG = {
  quick: "#E8EDF6",       // soft blue/lavender
  files: "#E4F0E8",       // soft green
  device: "#E4F0E8",      // soft green/teal
  protection: "#F5F0DC",  // soft cream/yellow
} as const;

const ICON_BG = {
  quick: "#D6DEF0",       // deeper blue tint for icon circles
  files: "#D4E8DA",       // deeper green tint
  device: "#D4E8DA",      // deeper green/teal tint
  protection: "#EDE6C8",  // deeper cream tint
} as const;

// ── Card Data ───────────────────────────────────────────────────────────────

const QUICK_CHECKS: CheckCard[] = [
  {
    id: "call",
    label: "Check a number",
    description: "Find out who called and whether it could be a scam.",
    icon: PhoneIncoming,
    route: "/call-guard",
    accessibilityHint: "Check a phone number for scam associations",
  },
  {
    id: "message",
    label: "Check a message",
    description: "Paste, share or add a screenshot of a message to check for scams.",
    icon: MessageSquareWarning,
    route: "/message",
    accessibilityHint: "Check a suspicious message for scams",
  },
  {
    id: "email",
    label: "Check email",
    description: "See if an email looks safe or suspicious.",
    icon: Mail,
    route: "/email",
    accessibilityHint: "Check an email for phishing or scams",
  },
  {
    id: "link",
    label: "Check Website Link",
    description: "See what\u2019s behind the link \u2014 safely and securely.",
    icon: Link2,
    route: "/check",
    accessibilityHint: "Check where a link leads before opening it",
  },
];

const FILES_APPS_CODES: CheckCard[] = [
  {
    id: "file",
    label: "Check a file",
    description: "Choose or share a download or attachment.",
    icon: FileSearch,
    route: "/file",
    accessibilityHint: "Check a file or attachment for suspicious content",
  },
  {
    id: "app",
    label: "Check an app",
    description: "Review an installed app or one you are thinking of installing.",
    icon: Smartphone,
    route: "/app-check",
    accessibilityHint: "Check an app for risky behaviour or permissions",
  },
  {
    id: "scan",
    label: "Scan a code",
    description: "Scan a QR code or barcode and check what it contains.",
    icon: ScanLine,
    route: "/scan",
    accessibilityHint: "Scan and check a QR code or barcode",
  },
];

const DEVICE_CONNECTION: CheckCard[] = [
  {
    id: "device",
    label: "Check my device",
    description: "Review important protection, permission and security settings.",
    icon: ShieldCheck,
    route: "/device",
    accessibilityHint: "Review device protection and security settings",
  },
  {
    id: "network",
    label: "Check my internet",
    description: "Review your current Wi-Fi or mobile-data connection and network security.",
    icon: Wifi,
    route: "/network",
    accessibilityHint: "Check your internet connection security",
  },
];

const PROTECTION_ACCOUNTS: CheckCard[] = [
  {
    id: "recheck",
    label: "Device Re-check",
    description: "Check for signs of malware, unsafe changes or compromise.",
    icon: ShieldCheck,
    route: "/recheck",
    accessibilityHint: "Re-check device for malware or unsafe changes",
  },
  {
    id: "accounts",
    label: "Check My Accounts",
    description: "Watch your emails for known data breaches with weekly reports.",
    icon: KeyRound,
    route: "/account-monitor",
    accessibilityHint: "Monitor email addresses for data breaches",
  },
  {
    id: "account-alert",
    label: "Check an account alert",
    description: "Review a login, breach or recovery warning without sharing private details.",
    icon: KeyRound,
    route: "/account",
    accessibilityHint: "Review an account security alert",
  },
];

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    color: c.onSurface,
    paddingBottom: spacing.sm,
  },
  headerIntro: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 21,
    color: c.onSurfaceSecondary,
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },

  // Section container (tinted background)
  sectionContainer: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 19,
    color: c.onSurface,
  },
  sectionSubtitle: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },

  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },

  // Card (white, inside tinted section)
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 4,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
  },
  cardLabel: {
    fontFamily: fonts.displayBold,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurface,
  },
  cardDescription: {
    fontFamily: fonts.text,
    fontSize: 11,
    lineHeight: 16,
    color: c.onSurfaceSecondary,
  },
  cardDescRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  cardDescText: {
    flex: 1,
  },
  cardChevron: {
    alignSelf: "center",
    flexShrink: 0,
  },

  // Saved checks card (full width, no section bg)
  savedCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  savedIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.navyTint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  savedContent: {
    flex: 1,
    gap: 3,
  },
  savedLabel: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 22,
    color: c.onSurface,
  },
  savedDescription: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
}));

// ── Check Card Component ────────────────────────────────────────────────────

function CheckCardItem({
  card,
  cardWidth,
  iconBg,
}: {
  card: CheckCard;
  cardWidth: number | string;
  iconBg: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = card.icon;

  return (
    <Pressable
      testID={`check-it-${card.id}`}
      accessibilityRole="button"
      accessibilityLabel={card.label}
      accessibilityHint={card.accessibilityHint}
      onPress={() => router.push(card.route as never)}
      style={({ pressed }) => [
        s.card,
        { width: cardWidth, opacity: pressed ? 0.78 : 1 },
      ]}
    >
      <View style={s.cardTopRow}>
        <View style={[s.cardIcon, { backgroundColor: iconBg }]}>
          <Icon size={14} color={colors.onSurface} />
        </View>
        <View style={s.cardContent}>
          <Text style={s.cardLabel}>{card.label}</Text>
        </View>
      </View>
      <View style={s.cardDescRow}>
        <Text style={[s.cardDescription, s.cardDescText]}>{card.description}</Text>
        <View style={s.cardChevron}>
          <ChevronRight size={14} color={colors.onSurfaceSecondary} />
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function CheckItScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();

  const padH = spacing.lg * 2;
  const sectionPad = spacing.md * 2;
  const innerWidth = width - padH - sectionPad;
  const gap = spacing.sm;

  // 2-column card width (10% narrower)
  const col2Width = (innerWidth - gap) / 2 * 0.9;
  // 3-column card width (10% narrower)
  const col3Width = (innerWidth - gap * 2) / 3 * 0.9;

  // Responsive: fall back to fewer columns on narrow screens
  const useNarrow = width < 320 || fontScale >= 1.5;
  const card2W = useNarrow ? innerWidth : col2Width;
  const card3W = useNarrow ? innerWidth : col3Width;

  return (
    <View style={s.root} testID="check-it-screen">
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={s.headerContainer}>
          <Text style={s.headerTitle}>Check</Text>
          <Text style={s.headerIntro}>
            Check messages, calls, links, files, apps and more. Spot scams,
            phishing and risky content before you click, open or share. When in
            doubt, check it with Apollo.
          </Text>
        </View>
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        testID="check-it-scroll"
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section A: Quick Checks ── */}
        <View
          style={[
            s.sectionContainer,
            { backgroundColor: SECTION_BG.quick },
          ]}
        >
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Quick Checks</Text>
            <Text style={s.sectionSubtitle}>
              The most common checks to help you stay safe every day.
            </Text>
          </View>
          <View style={s.grid}>
            {QUICK_CHECKS.map((card) => (
              <CheckCardItem
                key={card.id}
                card={card}
                cardWidth={card2W}
                iconBg={ICON_BG.quick}
              />
            ))}
          </View>
        </View>

        {/* ── Section B: Files, Apps & Codes ── */}
        <View
          style={[
            s.sectionContainer,
            { backgroundColor: SECTION_BG.files },
          ]}
        >
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Files, Apps & Codes</Text>
            <Text style={s.sectionSubtitle}>
              Check what you download, install or scan before you open it.
            </Text>
          </View>
          <View style={s.grid}>
            {FILES_APPS_CODES.map((card) => (
              <CheckCardItem
                key={card.id}
                card={card}
                cardWidth={card3W}
                iconBg={ICON_BG.files}
              />
            ))}
          </View>
        </View>

        {/* ── Section C: Your Device & Connection ── */}
        <View
          style={[
            s.sectionContainer,
            { backgroundColor: SECTION_BG.device },
          ]}
        >
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Your Device & Connection</Text>
            <Text style={s.sectionSubtitle}>
              Check your device and internet for a safer, stronger setup.
            </Text>
          </View>
          <View style={s.grid}>
            {DEVICE_CONNECTION.map((card) => (
              <CheckCardItem
                key={card.id}
                card={card}
                cardWidth={card2W}
                iconBg={ICON_BG.device}
              />
            ))}
          </View>
        </View>

        {/* ── Section D: Protection & accounts ── */}
        <View
          style={[
            s.sectionContainer,
            { backgroundColor: SECTION_BG.protection },
          ]}
        >
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Protection & accounts</Text>
            <Text style={s.sectionSubtitle}>
              Keep an eye on your wider security and accounts.
            </Text>
          </View>
          <View style={s.grid}>
            {PROTECTION_ACCOUNTS.map((card) => (
              <CheckCardItem
                key={card.id}
                card={card}
                cardWidth={card3W}
                iconBg={ICON_BG.protection}
              />
            ))}
          </View>
        </View>

        {/* ── Section E: Saved Checks ── */}
        <Pressable
          testID="check-it-saved"
          accessibilityRole="button"
          accessibilityLabel="Saved checks"
          accessibilityHint="Reopen app, link, message and internet checks you saved earlier"
          onPress={() => router.push("/saved-checks" as never)}
          style={({ pressed }) => [
            s.savedCard,
            { opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <View style={s.savedIcon}>
            <Bookmark size={22} color={colors.onSurface} />
          </View>
          <View style={s.savedContent}>
            <Text style={s.savedLabel}>Saved checks</Text>
            <Text style={s.savedDescription}>
              Reopen app, link, message and internet checks you saved earlier.
            </Text>
          </View>
          <ChevronRight size={18} color={colors.onSurfaceSecondary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}
