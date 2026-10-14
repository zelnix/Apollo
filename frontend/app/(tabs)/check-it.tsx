// Check screen — Apollo's security toolbox.
// Organised into sections: Quick Checks, Files/Apps/Codes,
// Device/Connection, Protection/Accounts, and Saved Checks.
// All existing check workflows, routes and functionality preserved.

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
    description: "Review important protection, permissions and security settings.",
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

// ── Section data ────────────────────────────────────────────────────────────

interface Section {
  title: string;
  subtitle: string;
  cards: CheckCard[];
  columns: 2 | 1;
}

const SECTIONS: Section[] = [
  {
    title: "Quick Checks",
    subtitle: "The most common checks to help you stay safe every day.",
    cards: QUICK_CHECKS,
    columns: 2,
  },
  {
    title: "Files, Apps & Codes",
    subtitle: "Check what you download, install or scan before you open it.",
    cards: FILES_APPS_CODES,
    columns: 2,
  },
  {
    title: "Your Device & Connection",
    subtitle: "Check your device and internet for a safer, stronger setup.",
    cards: DEVICE_CONNECTION,
    columns: 2,
  },
  {
    title: "Protection & Accounts",
    subtitle: "Keep an eye on your wider security and accounts.",
    cards: PROTECTION_ACCOUNTS,
    columns: 2,
  },
];

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
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
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },

  // Section
  sectionContainer: {
    gap: spacing.md,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
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

  // Card
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.navyTint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardLabel: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: 20,
    color: c.onSurface,
  },
  cardDescription: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
  cardChevron: {
    alignSelf: "center",
    flexShrink: 0,
  },

  // Full-width card (Saved checks)
  fullCard: {
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  fullCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.navyTint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fullCardContent: {
    flex: 1,
    gap: 4,
  },
  fullCardLabel: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 22,
    color: c.onSurface,
  },
  fullCardDescription: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },
}));

// ── Check Card Component ────────────────────────────────────────────────────

function CheckCardItem({
  card,
  cardWidth,
}: {
  card: CheckCard;
  cardWidth: number | string;
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
      <View style={s.cardInner}>
        <View style={s.cardIcon}>
          <Icon size={20} color={colors.brand} />
        </View>
        <View style={s.cardContent}>
          <Text style={s.cardLabel}>{card.label}</Text>
          <Text style={s.cardDescription}>{card.description}</Text>
        </View>
        <View style={s.cardChevron}>
          <ChevronRight size={18} color={colors.onSurfaceSecondary} />
        </View>
      </View>
    </Pressable>
  );
}

// ── Section Component ───────────────────────────────────────────────────────

function CheckSection({
  section,
  cardWidth,
}: {
  section: Section;
  cardWidth: number | string;
}) {
  const s = useStyles();

  return (
    <View style={s.sectionContainer}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{section.title}</Text>
        <Text style={s.sectionSubtitle}>{section.subtitle}</Text>
      </View>
      <View style={s.grid}>
        {section.cards.map((card) => (
          <CheckCardItem key={card.id} card={card} cardWidth={cardWidth} />
        ))}
      </View>
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function CheckItScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();

  const oneColumn = width < 360 || fontScale >= 1.35;
  const cardWidth = oneColumn
    ? "100%"
    : (width - spacing.xl * 2 - spacing.sm) / 2;

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
        {/* Sections A–D */}
        {SECTIONS.map((section) => (
          <CheckSection
            key={section.title}
            section={section}
            cardWidth={cardWidth}
          />
        ))}

        {/* Section E — Saved Checks */}
        <Pressable
          testID="check-it-saved"
          accessibilityRole="button"
          accessibilityLabel="Saved checks"
          accessibilityHint="Reopen app, link, message and internet checks you saved earlier"
          onPress={() => router.push("/saved-checks" as never)}
          style={({ pressed }) => [
            s.fullCard,
            { opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <View style={s.fullCardIcon}>
            <Bookmark size={22} color={colors.brand} />
          </View>
          <View style={s.fullCardContent}>
            <Text style={s.fullCardLabel}>Saved checks</Text>
            <Text style={s.fullCardDescription}>
              Reopen app, link, message and internet checks you saved earlier.
            </Text>
          </View>
          <ChevronRight size={18} color={colors.onSurfaceSecondary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}
