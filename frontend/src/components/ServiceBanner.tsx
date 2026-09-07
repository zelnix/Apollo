// Truthful connectivity banner (Hardening Gate step 3). Shown only while the security service is degraded.
// Wording is deliberate: "backend unreachable" ≠ "unprotected" — Site Guard and on-device checks continue.
import CloudOff from "lucide-react-native/icons/cloud-off";
import React, { useState } from "react";
import { Text, View } from "react-native";

import { probeBackend, useBackendHealth } from "@/src/api/backendHealth";
import { Body, Button, Card } from "@/src/components/ui";
import { serviceBannerCopy, staleNote } from "@/src/domain/serviceHealth";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stale: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.unknown },
}));

export function ServiceBanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const health = useBackendHealth();
  const [busy, setBusy] = useState(false);
  const copy = serviceBannerCopy(health);
  if (!copy) return null;
  const retry = async () => { setBusy(true); try { await probeBackend(); } finally { setBusy(false); } };
  return (
    <Card style={{ gap: spacing.sm, borderColor: colors.unknown }} testID="service-banner">
      <View style={s.row}>
        <CloudOff size={20} color={colors.unknown} />
        <Text style={[s.title, { flex: 1 }]} testID="service-banner-title">{copy.title}</Text>
      </View>
      <Body testID="service-banner-line">{copy.line}</Body>
      {copy.lastSeen ? <Body testID="service-banner-last">Last reached {new Date(copy.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Body> : null}
      <Button testID="service-banner-retry" variant="secondary" label={busy ? "Checking…" : "Try again"} disabled={busy} onPress={() => void retry()} />
    </Card>
  );
}

/** One line under data that was fetched earlier but could not be refreshed. Pass react-query results. */
export function StaleNote({ queries, testID }: { queries: { isError: boolean; dataUpdatedAt: number; data: unknown }[]; testID?: string }) {
  const s = useStyles();
  const failing = queries.filter((q) => q.isError);
  if (!failing.length) return null;
  const withData = failing.filter((q) => q.data !== undefined);
  const oldest = withData.length ? Math.min(...withData.map((q) => q.dataUpdatedAt)) : null;
  return <Text style={s.stale} testID={testID ?? "stale-note"}>{staleNote(oldest)}</Text>;
}
