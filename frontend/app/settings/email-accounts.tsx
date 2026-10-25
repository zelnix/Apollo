// Settings > Connect email accounts — manage Gmail connections.
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
import Shield from "lucide-react-native/icons/shield";
import ShieldOff from "lucide-react-native/icons/shield-off";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { getDeviceIdentity } from "@/src/auth/deviceIdentity";
import { Body, Card, SectionTitle } from "@/src/components/ui";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface GmailAccount {
  email: string;
  connected_at?: string;
  monitoring_enabled?: boolean;
}

interface GmailStatus {
  connected: boolean;
  configured: boolean;
  accounts: GmailAccount[];
  monitoring_enabled: boolean;
  monitor_state: string;
  monitor_last_checked_at?: string;
  monitor_last_success_at?: string;
  monitor_last_error_at?: string;
}

const MONITOR_STATE_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "off" }> = {
  ready: { label: "Active", tone: "ok" },
  checking: { label: "Checking now", tone: "ok" },
  needs_attention: { label: "Needs attention", tone: "warn" },
  off: { label: "Monitoring off", tone: "off" },
  disconnected: { label: "Not connected", tone: "off" },
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.pill,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, flex: 1 },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xl },
  description: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },
  accountRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  accountIconWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  gmailWell: { backgroundColor: "#FEE2E2" },
  accountInfo: { flex: 1, gap: 2 },
  accountEmail: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  accountMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  gmailM: { fontFamily: fonts.displayBold, fontSize: 20, color: "#EA4335" },
  disconnectBtn: {
    width: 44,
    height: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
  },
  connectCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  connectIconWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#DBEAFE",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  connectLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary, flex: 1 },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  emptyWrap: { alignItems: "center" as const, gap: spacing.md, paddingVertical: spacing.xl },
  // Monitoring section
  monitorRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: spacing.md,
  },
  monitorLeft: { flex: 1, gap: 2, paddingRight: spacing.md },
  monitorTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  monitorSubtitle: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  // Status badge
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusText: { fontFamily: fonts.textSemibold, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  // Note banner
  noteBanner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  noteText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, flex: 1 },
}));

export default function EmailAccountsScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [monitorToggling, setMonitorToggling] = useState(false);
  const [note, setNote] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [deviceLoaded, setDeviceLoaded] = useState(false);

  useEffect(() => {
    void getDeviceIdentity().then((id) => {
      setDeviceId(id?.deviceId ?? null);
      setDeviceLoaded(true);
    }).catch(() => setDeviceLoaded(true));
  }, []);

  const loadAccounts = useCallback(
    async (silent = false) => {
      if (!deviceId) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<GmailStatus>(`/gmail/status?device_id=${deviceId}`);
        setStatus(data);
        setAccounts(
          data.accounts ?? (data.connected ? [{ email: "Connected account" }] : []),
        );
      } catch {
        setAccounts([]);
        setStatus(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [deviceId],
  );

  useEffect(() => {
    if (deviceLoaded) void loadAccounts();
  }, [loadAccounts, deviceLoaded]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadAccounts(true);
  }, [loadAccounts]);

  // ── Connect ──
  const connectNew = async () => {
    if (!deviceId) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await connectGmailOAuth(deviceId);
      if (result === "connected") {
        setNote({ text: "Gmail account connected successfully.", type: "success" });
        await loadAccounts(true);
      } else if (result === "denied") {
        setNote({
          text: "Permission was denied. ApolloSG needs read-only access to check emails for threats. No emails are modified or sent.",
          type: "error",
        });
      } else if (result === "cancelled") {
        // User dismissed — no note needed
      } else {
        setNote({ text: "Could not connect. Please try again.", type: "error" });
      }
    } catch {
      setNote({ text: "Connection failed. Please check your internet connection and try again.", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── Disconnect ──
  const confirmDisconnect = (email: string) => {
    Alert.alert(
      "Disconnect account?",
      `ApolloSG will lose access to ${email}. You can reconnect at any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void performDisconnect(email),
        },
      ],
    );
  };

  const performDisconnect = async (email: string) => {
    if (!deviceId) return;
    setBusy(true);
    setNote(null);
    try {
      const qs =
        email !== "Connected account"
          ? `?device_id=${deviceId}&email=${encodeURIComponent(email)}`
          : `?device_id=${deviceId}`;
      await apiDelete(`/gmail/connection${qs}`);
      setNote({ text: `Disconnected ${email}.`, type: "info" });
      await loadAccounts(true);
    } catch {
      setNote({ text: "Could not disconnect. Please try again.", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── Monitoring toggle ──
  const toggleMonitoring = async (enabled: boolean) => {
    if (!deviceId) return;
    setMonitorToggling(true);
    try {
      await apiPost("/gmail/monitoring", "gmail_monitor", { device_id: deviceId, enabled });
      setNote({
        text: enabled
          ? "Email monitoring enabled. Apollo will periodically check for threats."
          : "Email monitoring paused.",
        type: enabled ? "success" : "info",
      });
      await loadAccounts(true);
    } catch {
      setNote({ text: "Could not update monitoring. Please try again.", type: "error" });
    } finally {
      setMonitorToggling(false);
    }
  };

  // ── Scan now ──
  const scanNow = async () => {
    if (!deviceId) return;
    setBusy(true);
    setNote(null);
    try {
      await apiPost("/gmail/scan", "gmail_scan", { device_id: deviceId });
      setNote({ text: "Scan started. Results will appear in Threats.", type: "success" });
      await loadAccounts(true);
    } catch {
      setNote({ text: "Could not start scan. Please try again.", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── Monitor state display ──
  const monitorInfo = MONITOR_STATE_LABELS[status?.monitor_state ?? "disconnected"] ?? MONITOR_STATE_LABELS.disconnected;
  const monitoringEnabled = status?.monitoring_enabled ?? false;
  const hasAccounts = accounts.length > 0;

  return (
    <View style={s.root} testID="email-accounts-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          testID="email-accounts-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBackOrHome(router)}
          style={s.backBtn}
        >
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Email accounts</Text>
        <AppMenuButton testID="email-accounts-menu" />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}
        testID="email-accounts-scroll"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        <Text style={s.description}>
          Connect email accounts so Apollo can check your emails for threats.{"\n"}
          ApolloSG uses read-only access and never modifies or sends emails.
        </Text>

        {/* ── Note banner ── */}
        {note ? (
          <View
            style={[
              s.noteBanner,
              {
                backgroundColor:
                  note.type === "success"
                    ? colors.restingTint
                    : note.type === "error"
                      ? colors.barkingTint
                      : "rgba(22,34,53,0.06)",
              },
            ]}
            testID="email-accounts-note"
          >
            {note.type === "success" ? (
              <CircleCheck size={16} color={colors.resting} />
            ) : note.type === "error" ? (
              <CircleAlert size={16} color={colors.barking} />
            ) : (
              <Mail size={16} color={colors.onSurfaceSecondary} />
            )}
            <Text
              style={[
                s.noteText,
                {
                  color:
                    note.type === "success"
                      ? colors.restingText
                      : note.type === "error"
                        ? colors.barkingText
                        : colors.onSurfaceSecondary,
                },
              ]}
            >
              {note.text}
            </Text>
          </View>
        ) : null}

        {/* ── Connected accounts ── */}
        <View>
          <SectionTitle>Connected accounts</SectionTitle>
          <Card testID="email-accounts-list">
            {loading ? (
              <View style={s.emptyWrap}>
                <ActivityIndicator size="small" color={colors.brand} />
                <Body>Loading accounts…</Body>
              </View>
            ) : hasAccounts ? (
              accounts.map((acct, i) => (
                <View
                  key={acct.email}
                  style={[s.accountRow, i > 0 && s.divider]}
                  testID={`email-account-${i}`}
                >
                  <View style={[s.accountIconWell, s.gmailWell]}>
                    <Text style={s.gmailM}>M</Text>
                  </View>
                  <View style={s.accountInfo}>
                    <Text style={s.accountEmail}>{acct.email}</Text>
                    <Text style={s.accountMeta}>
                      {"Gmail · Read-only"}
                      {acct.connected_at
                        ? ` · Connected ${new Date(acct.connected_at).toLocaleDateString()}`
                        : ""}
                    </Text>
                  </View>
                  <Pressable
                    testID={`email-account-disconnect-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Disconnect ${acct.email}`}
                    onPress={() => confirmDisconnect(acct.email)}
                    disabled={busy}
                    style={({ pressed }) => [s.disconnectBtn, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Trash size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))
            ) : (
              <View style={s.emptyWrap}>
                <Mail size={32} color={colors.muted} />
                <Body>No email accounts connected.</Body>
              </View>
            )}

            {/* Connect new account */}
            <Pressable
              testID="email-account-connect"
              accessibilityRole="button"
              onPress={() => void connectNew()}
              disabled={busy || !deviceId}
              style={({ pressed }) => [
                s.connectCard,
                hasAccounts && s.divider,
                { opacity: pressed && !busy ? 0.7 : 1 },
              ]}
            >
              <View style={s.connectIconWell}>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                ) : (
                  <Plus size={22} color={colors.brandPrimary} />
                )}
              </View>
              <Text style={s.connectLabel}>
                {busy ? "Connecting…" : "Connect Gmail account"}
              </Text>
            </Pressable>
          </Card>
        </View>

        {/* ── Email monitoring ── */}
        {hasAccounts ? (
          <View>
            <SectionTitle>Email monitoring</SectionTitle>
            <Card>
              {/* Toggle */}
              <View style={s.monitorRow}>
                <View style={s.monitorLeft}>
                  <Text style={s.monitorTitle}>Auto-check emails</Text>
                  <Text style={s.monitorSubtitle}>
                    Apollo periodically checks for suspicious emails
                  </Text>
                </View>
                {monitorToggling ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Switch
                    testID="email-monitor-toggle"
                    value={monitoringEnabled}
                    onValueChange={(val) => void toggleMonitoring(val)}
                    trackColor={{ false: colors.border, true: colors.brand }}
                  />
                )}
              </View>

              <View style={s.divider} />

              {/* Status */}
              <View style={s.monitorRow}>
                <View style={s.monitorLeft}>
                  <Text style={s.monitorTitle}>Status</Text>
                  <View style={s.statusRow}>
                    <View
                      style={[
                        s.statusBadge,
                        {
                          backgroundColor:
                            monitorInfo.tone === "ok"
                              ? colors.restingTint
                              : monitorInfo.tone === "warn"
                                ? colors.barkingTint
                                : "rgba(22,34,53,0.06)",
                        },
                      ]}
                    >
                      {monitorInfo.tone === "ok" ? (
                        <Shield size={12} color={colors.resting} />
                      ) : monitorInfo.tone === "warn" ? (
                        <CircleAlert size={12} color={colors.barking} />
                      ) : (
                        <ShieldOff size={12} color={colors.muted} />
                      )}
                      <Text
                        style={[
                          s.statusText,
                          {
                            color:
                              monitorInfo.tone === "ok"
                                ? colors.restingText
                                : monitorInfo.tone === "warn"
                                  ? colors.barkingText
                                  : colors.muted,
                          },
                        ]}
                      >
                        {monitorInfo.label}
                      </Text>
                    </View>
                  </View>
                  {status?.monitor_last_checked_at ? (
                    <Text style={s.monitorSubtitle}>
                      Last checked:{" "}
                      {new Date(status.monitor_last_checked_at).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Text>
                  ) : null}
                </View>
                {monitoringEnabled ? (
                  <Pressable
                    testID="email-scan-now"
                    accessibilityRole="button"
                    accessibilityLabel="Scan now"
                    onPress={() => void scanNow()}
                    disabled={busy}
                    style={({ pressed }) => [
                      {
                        width: 44,
                        height: 44,
                        alignItems: "center" as const,
                        justifyContent: "center" as const,
                        borderRadius: radius.pill,
                        backgroundColor: colors.surfaceTertiary,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <RefreshCw size={18} color={colors.brand} />
                  </Pressable>
                ) : null}
              </View>
            </Card>
          </View>
        ) : null}

        {/* ── About ── */}
        <View>
          <SectionTitle>About email access</SectionTitle>
          <Card>
            <Body>
              ApolloSG requests read-only access to your Gmail inbox through Google&apos;s secure
              OAuth flow. Your credentials are never stored by ApolloSG.
            </Body>
            <Body>
              You can disconnect any account at any time. Disconnecting removes ApolloSG&apos;s
              access immediately.
            </Body>
            {monitoringEnabled ? (
              <Body>
                When monitoring is enabled, Apollo periodically checks recent emails and flags
                anything suspicious. Results appear in the Threats screen.
              </Body>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
