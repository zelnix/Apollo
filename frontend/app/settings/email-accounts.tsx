// Settings > Connect email accounts — manage Gmail connections.
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash-2";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet } from "@/src/api/client";
import { getDeviceToken } from "@/src/auth/deviceIdentity";
import { Body, Card, SectionTitle } from "@/src/components/ui";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface GmailAccount { email: string; connected_at?: string }

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingBottom: spacing.md },
  backBtn: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: radius.pill },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, flex: 1 },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xl },
  description: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  accountRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingVertical: spacing.md },
  accountIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const },
  gmailWell: { backgroundColor: "#FEE2E2" },
  accountInfo: { flex: 1, gap: 2 },
  accountEmail: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  accountMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  gmailM: { fontFamily: fonts.displayBold, fontSize: 20, color: "#EA4335" },
  disconnectBtn: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  connectCard: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingVertical: spacing.md },
  connectIconWell: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", alignItems: "center" as const, justifyContent: "center" as const },
  connectLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary, flex: 1 },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  emptyWrap: { alignItems: "center" as const, gap: spacing.md, paddingVertical: spacing.xl },
}));

export default function EmailAccountsScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { void getDeviceToken().then(setDeviceId); }, []);

  const loadAccounts = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const data = await apiGet<{ connected: boolean; monitoring?: boolean; accounts?: GmailAccount[] }>(
        `/gmail/status?device_id=${deviceId}`,
      );
      setAccounts(data.accounts ?? (data.connected ? [{ email: "Connected account" }] : []));
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const connectNew = async () => {
    if (!deviceId) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await connectGmailOAuth(deviceId);
      if (result === "connected") {
        setNote("Gmail account connected successfully.");
        await loadAccounts();
      } else if (result === "denied") {
        setNote("Permission was denied. Apollo needs read-only access to check emails.");
      } else if (result === "cancelled") {
        setNote(null);
      } else {
        setNote("Could not connect. Please try again.");
      }
    } catch {
      setNote("Connection failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (email: string) => {
    if (!deviceId) return;
    setBusy(true);
    setNote(null);
    try {
      const qs = email !== "Connected account" ? `?device_id=${deviceId}&account=${encodeURIComponent(email)}` : `?device_id=${deviceId}`;
      await apiDelete(`/gmail/connection${qs}`);
      setNote(`Disconnected ${email}.`);
      await loadAccounts();
    } catch {
      setNote("Could not disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root} testID="email-accounts-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="email-accounts-back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOrHome(router)} style={s.backBtn}>
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Email accounts</Text>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="email-accounts-scroll">
        <Text style={s.description}>
          Connect email accounts so Apollo can show your recent emails for checking.
          Apollo uses read-only access and never modifies or sends emails.
        </Text>

        <View>
          <SectionTitle>Connected accounts</SectionTitle>
          <Card testID="email-accounts-list">
            {loading ? (
              <View style={s.emptyWrap}>
                <ActivityIndicator size="small" color={colors.brand} />
                <Body>Loading accounts\u2026</Body>
              </View>
            ) : accounts.length > 0 ? (
              accounts.map((acct, i) => (
                <View key={acct.email} style={[s.accountRow, i > 0 && s.divider]} testID={`email-account-${i}`}>
                  <View style={[s.accountIconWell, s.gmailWell]}>
                    <Text style={s.gmailM}>M</Text>
                  </View>
                  <View style={s.accountInfo}>
                    <Text style={s.accountEmail}>{acct.email}</Text>
                    <Text style={s.accountMeta}>Gmail \u00B7 Read-only{acct.connected_at ? ` \u00B7 Connected ${new Date(acct.connected_at).toLocaleDateString()}` : ""}</Text>
                  </View>
                  <Pressable
                    testID={`email-account-disconnect-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Disconnect ${acct.email}`}
                    onPress={() => void disconnect(acct.email)}
                    disabled={busy}
                    style={({ pressed }) => [s.disconnectBtn, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Trash2 size={18} color={colors.error} />
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
              style={({ pressed }) => [s.connectCard, accounts.length > 0 && s.divider, { opacity: pressed && !busy ? 0.7 : 1 }]}
            >
              <View style={s.connectIconWell}>
                {busy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Plus size={22} color={colors.brandPrimary} />}
              </View>
              <Text style={s.connectLabel}>{busy ? "Connecting\u2026" : "Connect Gmail account"}</Text>
            </Pressable>
          </Card>
        </View>

        {note ? <Body testID="email-accounts-note">{note}</Body> : null}

        <View>
          <SectionTitle>About email access</SectionTitle>
          <Card>
            <Body>Apollo requests read-only access to your Gmail inbox through Google&apos;s secure OAuth flow. Your credentials are never stored by Apollo.</Body>
            <Body>You can disconnect any account at any time. Disconnecting removes Apollo&apos;s access immediately.</Body>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
