// Privacy & Data — an honest inventory of everything Apollo stores for this device and a verified
// "Delete My Apollo Data" flow (type-to-confirm). Deletion erases the service copy, wipes this phone
// and returns Apollo to a first-run state. Offline deletion is recorded as pending and retried on reconnect.
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { Sheet } from "@/src/components/Sheet";
import { apiGet } from "@/src/api/client";
import { CONFIRM_WORD, PENDING_DELETE_KEY, RETENTION_INVENTORY, type DataInventory } from "@/src/domain/privacyData";
import { useApollo } from "@/src/store/ApolloContext";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  item: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  itemHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  what: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  retention: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  dangerCard: { gap: spacing.md, borderWidth: 1, borderColor: c.barkingText },
  dangerTitle: { fontFamily: fonts.textSemibold, fontSize: 17, color: c.barkingText },
  input: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.textMedium, fontSize: 16, color: c.onSurface, backgroundColor: c.surfaceSecondary, letterSpacing: 2 },
  pending: { gap: spacing.xs, borderWidth: 1, borderColor: c.growling, backgroundColor: c.surfaceSecondary },
}));

export default function PrivacyDataScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { requestDataDeletion, showToast } = useApollo();
  const [inv, setInv] = useState<DataInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [invError, setInvError] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true); setInvError(false);
    try { setInv(await apiGet<DataInventory>("/devices/data-inventory")); }
    catch { setInvError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { void storage.getItem(PENDING_DELETE_KEY, false).then((v) => setPending(!!v)); }, []);

  const countFor = (key: string): number | null => {
    if (!inv) return null;
    const row = inv.categories.find((c) => c.key === key);
    return row ? row.count : 0;
  };

  const runDelete = async () => {
    setShowSheet(false); setBusy(true);
    const res = await requestDataDeletion();
    setBusy(false);
    if (res.ok) {
      showToast("Your Apollo data has been deleted. Set up Apollo again whenever you're ready.", "neutral");
      router.replace("/onboarding");
    } else {
      setPending(true);
      showToast("You're offline. Apollo will finish deleting your data as soon as it reconnects.", "growling");
    }
  };

  const confirmed = confirm.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <View style={s.root} testID="privacy-data-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} testID="privacy-data-title">Privacy &amp; data</Text>
        <Pressable testID="privacy-data-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="privacy-data-scroll" keyboardShouldPersistTaps="handled">
        <Body testID="privacy-data-intro">Apollo uses an anonymous device identity — no account, no name, no advertising tracking. Here is everything Apollo stores for this device, where it lives and for how long.</Body>

        {pending ? (
          <Card testID="privacy-data-pending" style={s.pending}>
            <Text style={s.dangerTitle}>Deletion pending</Text>
            <Body>You asked Apollo to delete your data while offline. Nothing has been erased yet. Apollo will finish the moment it reconnects — stay on Wi-Fi or mobile data.</Body>
            <Button testID="privacy-data-retry" variant="secondary" label="Try now" onPress={() => void runDelete()} />
          </Card>
        ) : null}

        <View>
          <SectionTitle>What Apollo stores</SectionTitle>
          <Card testID="privacy-data-inventory">
            {loading ? <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View> : null}
            {!loading && invError ? (
              <View style={{ gap: spacing.sm }}>
                <Body testID="privacy-data-inv-error">Apollo couldn&apos;t load the live count right now. The categories below still apply.</Body>
                <Button testID="privacy-data-inv-retry" variant="ghost" label="Try again" onPress={() => void loadInventory()} />
              </View>
            ) : null}
            {RETENTION_INVENTORY.map((row, i) => {
              const count = row.where === "service" ? countFor(row.key) : null;
              const last = i === RETENTION_INVENTORY.length - 1;
              return (
                <View key={row.key} style={[s.item, last && { borderBottomWidth: 0 }]} testID={`privacy-data-row-${row.key}`}>
                  <View style={s.itemHead}>
                    <Text style={s.what}>{row.label}</Text>
                    {row.where === "device"
                      ? <Pill tone="neutral" label="On this device" />
                      : count === null ? null : <Pill tone={count > 0 ? "resting" : "neutral"} label={count > 0 ? `${count} stored` : "None stored"} testID={`privacy-data-count-${row.key}`} />}
                  </View>
                  <Body>{row.what}</Body>
                  <Text style={s.retention}>{row.retention}</Text>
                </View>
              );
            })}
          </Card>
          <Pressable testID="privacy-data-disclosure" accessibilityRole="button" onPress={() => router.push("/privacy-disclosure")} style={{ paddingTop: spacing.sm }}>
            <Text style={{ fontFamily: fonts.textMedium, fontSize: 14, color: colors.brand, textDecorationLine: "underline" }}>Read the full privacy disclosure</Text>
          </Pressable>
        </View>

        <View>
          <SectionTitle>Delete my Apollo data</SectionTitle>
          <Card testID="privacy-data-delete" style={s.dangerCard}>
            <Text style={s.dangerTitle}>This cannot be undone</Text>
            <Body>Deleting erases everything above — on Apollo&apos;s service and on this phone — and signs this device out. Apollo returns to the welcome screen and you can set it up fresh anytime. Trusted links, saved checks, Patrol history, Higgins conversations and family pairings are all removed.</Body>
            <Body>To confirm, type <Text style={{ fontFamily: fonts.textSemibold, color: colors.onSurface }}>{CONFIRM_WORD}</Text> below.</Body>
            <TextInput
              testID="privacy-data-confirm-input"
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.muted}
              editable={!busy}
            />
            <Button
              testID="privacy-data-delete-button"
              variant="danger"
              label={busy ? "Deleting…" : "Delete My Apollo Data"}
              disabled={!confirmed || busy}
              icon={busy ? <ActivityIndicator color={colors.onError} /> : undefined}
              onPress={() => setShowSheet(true)}
            />
          </Card>
        </View>
      </ScrollView>

      <Sheet visible={showSheet} onClose={() => setShowSheet(false)} title="Delete everything?" testID="privacy-data-sheet">
        <Body>This permanently erases all of your Apollo data on the service and on this phone. You can&apos;t get it back.</Body>
        <Button testID="privacy-data-sheet-confirm" variant="danger" label="Yes, delete everything" onPress={() => void runDelete()} />
        <Button testID="privacy-data-sheet-cancel" variant="ghost" label="Keep my data" onPress={() => setShowSheet(false)} />
      </Sheet>
    </View>
  );
}
