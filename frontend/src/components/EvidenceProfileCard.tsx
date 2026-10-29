// Evidence received — Higgins Triage's classification of the evidence behind a check (email: L1–L4), what each
// capability's status is (verified / recorded / observed / unavailable), the investigation signals it raised and
// every earlier level the case has had. Presentation only; words come from the catalogue.
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button, Card, Pill, type Tone } from "@/src/components/ui";
import { PROFILE_WORDS, statusLabel, upgrades, type CapabilityStatus, type EvidenceProfile } from "@/src/domain/triage/evidenceProfile";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const STATUS_TONE: Record<CapabilityStatus, Tone> = { verified: "resting", recorded: "neutral", observed: "neutral", unavailable: "unknown" };

const useStyles = makeStyles((c) => ({
  label: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" as const },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  toggle: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, minHeight: 44 },
  toggleText: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  row: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  rowHead: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  rowName: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  rowValue: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurface },
  signals: { gap: spacing.xs, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md },
  signalTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  bullet: { flexDirection: "row" as const, gap: spacing.sm },
  notice: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderLeftWidth: 3, borderLeftColor: c.brandPrimary },
}));

export function EvidenceProfileCard({ profile, onAddOriginal, busy, notice, testID = "evidence-profile" }: {
  profile: EvidenceProfile;
  /** Offered while the evidence is below the original message (L1/L2). */
  onAddOriginal?: () => void;
  busy?: boolean;
  /** What just changed with the evidence (an upgrade, or an original that didn't match). */
  notice?: string | null;
  testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const examined = profile.capabilities.filter((c) => c.status !== "unavailable").length;
  const hasAuth = profile.type === "email" && profile.capabilities.some((c) => ["spf", "dkim", "dmarc"].includes(c.id) && c.status === "recorded");

  return (
    <Card style={{ gap: spacing.md }} testID={testID}>
      <Text style={s.label}>Evidence received</Text>
      {notice ? (
        <View style={s.notice} testID={`${testID}-notice`} accessibilityLiveRegion="polite">
          <Text style={s.rowValue}>{notice}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Pill tone="neutral" label={profile.label} testID={`${testID}-level`} />
        {profile.simulated ? <Pill tone="neutral" label="Simulated" testID={`${testID}-simulated`} /> : null}
      </View>
      <Text style={s.body} testID={`${testID}-basis`}>{profile.basis}</Text>
      <Text style={s.meta}>{`Classified by ${profile.classifiedBy} · ${profile.viaLabel}`}</Text>
      {upgrades(profile).map(({ from, to }) => (
        <Text key={`${to.level}-${to.at}`} style={s.meta} testID={`${testID}-upgrade`}>
          {`Upgraded from ${from.label} to ${to.label} · ${new Date(to.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
        </Text>
      ))}

      {profile.signals.length ? (
        <View style={s.signals} testID={`${testID}-signals`}>
          <Text style={s.signalTitle}>{PROFILE_WORDS.signalsTitle}</Text>
          {profile.signals.map((sig) => (
            <View key={sig.id} style={s.bullet}>
              <Text style={s.rowValue}>•</Text>
              <Text style={[s.rowValue, { flex: 1 }]}>{sig.text}</Text>
            </View>
          ))}
          <Text style={s.meta}>{PROFILE_WORDS.caution}</Text>
        </View>
      ) : null}

      <View>
        <Pressable accessibilityRole="button" accessibilityLabel={open ? "Hide what ApolloSG could examine" : "Show what ApolloSG could examine"}
          onPress={() => setOpen((v) => !v)} style={s.toggle} testID={`${testID}-toggle`}>
          <Text style={s.toggleText}>{`What ApolloSG could examine (${examined} of ${profile.capabilities.length})`}</Text>
          {open ? <ChevronUp size={18} color={colors.onSurface} /> : <ChevronDown size={18} color={colors.onSurface} />}
        </Pressable>
        {open ? profile.capabilities.map((c) => (
          <View key={c.id} style={s.row} testID={`${testID}-cap-${c.id}`}>
            <View style={s.rowHead}>
              <Text style={s.rowName}>{c.label}</Text>
              <Pill compact tone={STATUS_TONE[c.status]} label={statusLabel(c.status)} />
            </View>
            {c.value ? <Text style={s.rowValue} selectable>{c.value}</Text> : null}
            {c.note ? <Text style={s.meta}>{c.note}</Text> : null}
          </View>
        )) : null}
        {open && hasAuth ? <Text style={[s.meta, { marginTop: spacing.sm }]}>{PROFILE_WORDS.authCaution}</Text> : null}
      </View>

      {onAddOriginal && profile.type === "email" && profile.rank < 3 ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={s.meta}>Add the original email (.eml) so Higgins Triage can read its full headers and the sender authentication its receiving mail server recorded. It&apos;s read on this device — only the findings leave it.</Text>
          <Button testID={`${testID}-add-original`} variant="secondary" label={busy ? "Reading the original…" : "Add the original email (.eml)"} onPress={onAddOriginal} disabled={busy} />
        </View>
      ) : null}
    </Card>
  );
}
