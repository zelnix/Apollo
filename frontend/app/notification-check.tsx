// Notification check — the three separate states behind "did an alert reach me?", each read from its
// real source: the OS permission on this phone, the Apollo alerts category (Android), and the push
// registration Apollo's servers hold for this installation. Nothing here claims delivery: the two
// test buttons report exactly what the device and the server actually answered.
import { useRouter } from "expo-router";
import Bell from "lucide-react-native/icons/bell";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import {
  getNotificationHealth,
  getPushRegistration,
  registerRemotePush,
  requestNotificationPermission,
  scheduleLocalAlert,
  sendServerTestAlert,
  type NotificationHealth,
  type PushRegistrationState,
} from "@/src/push/notifications";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface NotifFailure { kind: string; message: string; at: string; context: string | null }

// ApolloContext records the last failure as a JSON string under this key.
async function readLastFailure(): Promise<NotifFailure | null> {
  const raw = await storage.getItem<string | null>("apollo.notif.lastFailure", null).catch(() => null);
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as NotifFailure; } catch { return null; }
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, flexShrink: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  row: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rowLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  mono: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  result: { gap: spacing.xs, borderWidth: 1, borderColor: c.borderStrong },
}));

export default function NotificationCheckScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [registration, setRegistration] = useState<PushRegistrationState | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [lastFailure, setLastFailure] = useState<NotifFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"device" | "server" | null>(null);
  const [deviceResult, setDeviceResult] = useState<string | null>(null);
  const [serverResult, setServerResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRegistrationError(null);
    setHealth(await getNotificationHealth().catch(() => null));
    try { setRegistration(await getPushRegistration()); }
    catch (e) { setRegistration(null); setRegistrationError(e instanceof Error ? e.message : "Apollo's servers could not be reached."); }
    setLastFailure(await readLastFailure());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A real local notification: if this doesn't appear in the notification bar, the problem is this
  // phone's permission or category — not Apollo's servers.
  const testOnDevice = useCallback(async () => {
    setBusy("device");
    setDeviceResult(null);
    try {
      await scheduleLocalAlert({
        title: "Apollo test alert",
        body: "If you can see this in your notifications, alerts from Apollo work on this phone.",
        channel: "apollo_alerts",
        actionUrl: "/notification-check",
      });
      setDeviceResult("Apollo asked this phone to show a notification. Check your notification bar — if nothing appeared there, the alert was blocked after Apollo handed it over.");
    } catch (e) {
      setDeviceResult(e instanceof Error ? e.message : "This phone refused the notification.");
    } finally {
      setBusy(null);
      void load();
    }
  }, [load]);

  // The remote path end to end: register a fresh token, then ask the server to send to it.
  const testFromServer = useCallback(async () => {
    setBusy("server");
    setServerResult(null);
    const reg = await registerRemotePush();
    if (!reg.registered) {
      setServerResult(`Apollo could not register this installation for alerts: ${reg.reason}`);
      setBusy(null);
      void load();
      return;
    }
    try {
      const status = await sendServerTestAlert();
      setServerResult(
        status.state === "provider_accepted" || status.state === "device_observed"
          ? `Accepted for delivery (${status.state}). If it doesn't appear, the platform push service dropped it after Apollo's part succeeded.`
          : `Delivery state: ${status.state}${status.failureCode ? ` — ${status.failureCode}` : ""}.`,
      );
    } catch (e) {
      setServerResult(e instanceof ApiError ? `${e.status}: ${e.message}` : e instanceof Error ? e.message : "The test alert could not be sent.");
    } finally {
      setBusy(null);
      void load();
    }
  }, [load]);

  return <View style={s.root} testID="notification-check-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} testID="notification-check-title">Notification check</Text>
      <Pressable testID="notification-check-close" accessibilityRole="button" accessibilityLabel="Close Notification check" onPress={() => goBackOrHome(router)} style={s.close}>
        <X size={22} color={colors.onSurface} />
      </Pressable>
    </View>

    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="notification-check-scroll">
      <Body testID="notification-check-intro">
        An alert has to pass three separate steps before you see it: this phone must allow notifications, the
        Apollo alerts category must be on, and — for alerts that arrive while Apollo is closed — Apollo&apos;s
        servers must hold a current registration for this installation. Each step below is read from its real
        source, and the tests report exactly what happened.
      </Body>

      <View>
        <SectionTitle>On this phone</SectionTitle>
        <Card testID="notification-check-device">
          {loading && !health ? <ActivityIndicator color={colors.gold} /> : null}
          <View style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowLabel}>Notification permission</Text>
              <Pill
                tone={health?.permission === "granted" ? "resting" : health?.permission === "unsupported" ? "unknown" : "growling"}
                label={health ? health.permission : "unknown"}
                testID="notification-check-permission"
              />
            </View>
            {health?.disabledReason ? <Body>{health.disabledReason}</Body> : null}
          </View>
          {Platform.OS === "android" ? (
            <View style={s.row}>
              <View style={s.rowHead}>
                <Text style={s.rowLabel}>&ldquo;Apollo alerts&rdquo; category</Text>
                <Pill
                  tone={health?.alertsChannelEnabled === false ? "growling" : health?.alertsChannelEnabled ? "resting" : "unknown"}
                  label={health?.alertsChannelEnabled === false ? "off" : health?.alertsChannelEnabled ? "on" : "not checked"}
                  testID="notification-check-channel"
                />
              </View>
              <Body>Android lets a category be switched off separately from the app&apos;s permission.</Body>
            </View>
          ) : null}
          {health && health.permission !== "granted" && health.permission !== "unsupported" ? (
            <Button
              testID="notification-check-allow"
              variant="secondary"
              label="Allow notifications"
              onPress={() => void requestNotificationPermission().then(() => load())}
            />
          ) : null}
          {health?.permission === "blocked" || health?.alertsChannelEnabled === false ? (
            <Button testID="notification-check-settings" variant="secondary" label="Open notification settings" onPress={() => void Linking.openSettings()} />
          ) : null}
          <Button
            testID="notification-check-test-device"
            label={busy === "device" ? "Sending…" : "Send a test alert to this phone"}
            onPress={() => void testOnDevice()}
            disabled={busy !== null}
            icon={busy === "device" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Bell size={18} color={colors.onBrandPrimary} />}
          />
          {deviceResult ? <Card style={s.result} testID="notification-check-device-result"><Body>{deviceResult}</Body></Card> : null}
        </Card>
      </View>

      <View>
        <SectionTitle>Alerts while Apollo is closed</SectionTitle>
        <Card testID="notification-check-server">
          <View style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowLabel}>Apollo&apos;s alert channel</Text>
              <Pill
                tone={registration?.configured ? "resting" : "growling"}
                label={registration?.configured ? "configured" : "not configured"}
                testID="notification-check-configured"
              />
            </View>
            {registration?.setupDetail ? <Body>{registration.setupDetail}</Body> : null}
            {registrationError ? <Body testID="notification-check-registration-error">{registrationError}</Body> : null}
          </View>
          <View style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowLabel}>This installation</Text>
              <Pill
                tone={registration?.registered ? "resting" : "growling"}
                label={registration?.registered ? "registered" : "not registered"}
                testID="notification-check-registered"
              />
            </View>
            <Body>
              {registration?.registered
                ? `Registered ${registration.registeredAt ? new Date(registration.registeredAt).toLocaleString() : "at an unrecorded time"}.`
                : "Apollo's servers have no destination for this installation, so an alert cannot be sent while Apollo is closed."}
            </Body>
            <Text style={s.mono}>
              Apollo registers this phone with its managed alert service. The phone&apos;s notification token stays with
              that service — it is never kept in Apollo&apos;s own records.
            </Text>
          </View>
          <Button
            testID="notification-check-test-server"
            variant="secondary"
            label={busy === "server" ? "Sending…" : "Send a test alert from Apollo's servers"}
            onPress={() => void testFromServer()}
            disabled={busy !== null}
          />
          {serverResult ? <Card style={s.result} testID="notification-check-server-result"><Body>{serverResult}</Body></Card> : null}
        </Card>
      </View>

      <View>
        <SectionTitle>Last recorded problem</SectionTitle>
        <Card testID="notification-check-failure">
          {lastFailure ? (
            <>
              <View style={s.rowHead}>
                <Text style={s.rowLabel}>{lastFailure.kind}</Text>
                <Text style={s.mono}>{new Date(lastFailure.at).toLocaleString()}</Text>
              </View>
              <Body>{lastFailure.message}</Body>
              {lastFailure.context ? <Text style={s.mono}>Context: {lastFailure.context}</Text> : null}
            </>
          ) : (
            <Body testID="notification-check-no-failure">Apollo has not recorded a notification failure on this phone.</Body>
          )}
          <Button testID="notification-check-refresh" variant="ghost" label="Check again" onPress={() => void load()} disabled={loading} />
        </Card>
      </View>
    </ScrollView>
  </View>;
}
