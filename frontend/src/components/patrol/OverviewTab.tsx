import React from "react";
import { Image, Text, View } from "react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Info from "lucide-react-native/icons/info";
import Settings from "lucide-react-native/icons/settings";

import { EventActions } from "@/src/components/EventActions";
import { Body, Button, Card, Pill, toneColor, toneTint } from "@/src/components/ui";
import { looksLikeInternalCode, scrubMessage } from "@/src/domain/messageVoice";
import type { HigginsBriefing, PatrolEvent } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useRouter } from "expo-router";
import { useApollo } from "@/src/store/ApolloContext";
import { APP_VERSION, NATIVE_BUILD_NUMBER, buildLabel } from "@/src/config/buildInfo";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  // Higgins header row
  higginsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  higginsAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: c.surfaceTertiary,
  },
  higginsAvatar: { width: 48, height: 48 },
  higginsTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  higginsSubtitle: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  // Alert/info/success banner cards
  bannerCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  bannerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  bannerContent: { flex: 1, gap: 4 },
  bannerTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    lineHeight: 20,
  },
  bannerBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    backgroundColor: c.divider,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  footer: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  buildInfo: {
    fontFamily: fonts.text,
    fontSize: 11,
    color: c.onSurfaceTertiary,
    textAlign: "center",
    paddingBottom: spacing.md,
  },
  // Briefing text
  briefingHeadline: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: c.onSurface,
    lineHeight: 28,
  },
  briefingBody: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurfaceSecondary,
  },
}));

export function OverviewTab({
  event,
  outcome,
  isMock,
  shownWhatToDo,
  focusFromAlert,
}: {
  event: PatrolEvent;
  outcome: PatrolOutcome | null;
  isMock: boolean;
  shownWhatToDo: string;
  focusFromAlert: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { events } = useApollo();
  const briefing: HigginsBriefing | undefined = event.patrol_record?.higginsBriefing ?? undefined;
  const isResolved = !!event.resolved_at;

  return (
    <View style={s.content}>
      {/* Higgins Briefing card */}
      <Card style={{ gap: spacing.md }} testID="event-higgins-briefing">
        {/* Higgins header */}
        <View style={s.higginsHeader}>
          <View style={s.higginsAvatarWrap}>
            <Image source={higginsAvatar} style={s.higginsAvatar} />
          </View>
          <View>
            <Text style={s.higginsTitle}>Higgins&apos; briefing</Text>
            <Text style={s.higginsSubtitle}>In plain English</Text>
          </View>
        </View>

        {/* Headline */}
        {briefing ? (
          <>
            <Text style={s.briefingHeadline}>{briefing.investigated}</Text>
            <Text style={s.briefingBody}>{briefing.established}</Text>
            {briefing.meaning && briefing.meaning !== briefing.established ? (
              <Text style={s.briefingBody}>{briefing.meaning}</Text>
            ) : null}
          </>
        ) : (
          <Text style={s.briefingBody}>
            {event.what_happened ?? "No briefing available for this event."}
          </Text>
        )}

        {/* Outcome banner (green for resolved, red for active threat) */}
        {isResolved ? (
          <View
            style={[
              s.bannerCard,
              { backgroundColor: colors.restingTint },
            ]}
          >
            <View style={[s.bannerIcon, { backgroundColor: colors.resting }]}>
              <CircleCheck size={16} color="#FFFFFF" />
            </View>
            <View style={s.bannerContent}>
              <Text style={[s.bannerTitle, { color: colors.restingText }]}>
                Current outcome: Resolved
              </Text>
              <Text style={[s.bannerBody, { color: colors.onSurfaceSecondary }]}>
                {scrubMessage(outcome?.resultBasis) ??
                  `This was marked resolved on ${event.resolved_at ? new Date(event.resolved_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "an earlier date"}.`}
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[
              s.bannerCard,
              { backgroundColor: colors.barkingTint },
            ]}
          >
            <View style={[s.bannerIcon, { backgroundColor: colors.barking }]}>
              <Info size={16} color="#FFFFFF" />
            </View>
            <View style={s.bannerContent}>
              <Text style={[s.bannerTitle, { color: colors.barkingText }]}>
                Current outcome: {scrubMessage(outcome?.result) ?? "Needs attention"}
              </Text>
              <Text style={[s.bannerBody, { color: colors.onSurfaceSecondary }]}>
                {scrubMessage(outcome?.resultBasis) ?? "This finding has not been resolved yet."}
              </Text>
            </View>
          </View>
        )}

        {/* Protection status at the time */}
        {event.patrol_record?.outageContext ? (() => {
          const ctx = event.patrol_record.outageContext as Record<string, unknown>;
          const msg = typeof ctx === "string" ? ctx : (ctx.message ?? ctx.summary ?? ctx.description ?? "Apollo's protection was limited at the time of this finding.");
          return (
            <View
              style={[
                s.bannerCard,
                { backgroundColor: "rgba(22,34,53,0.06)" },
              ]}
            >
              <View style={[s.bannerIcon, { backgroundColor: colors.info }]}>
                <Info size={16} color="#FFFFFF" />
              </View>
              <View style={s.bannerContent}>
                <Text style={[s.bannerTitle, { color: colors.onSurface }]}>
                  Apollo&apos;s protection status at the time
                </Text>
                <Text style={[s.bannerBody, { color: colors.onSurfaceSecondary }]}>
                  {String(msg)}
                </Text>
              </View>
            </View>
          );
        })() : null}
      </Card>

      {/* Divider */}
      <View style={s.divider} />

      {/* Do you need to do anything? */}
      <Text style={s.sectionTitle}>Do you need to do anything?</Text>
      <Body>{shownWhatToDo}</Body>

      {/* Action button */}
      {briefing?.action ? (
        <EventActions event={event} />
      ) : (
        <EventActions event={event} />
      )}

      {/* Connected incident */}
      {event.scent_id &&
      events.filter((e) => e.scent_id === event.scent_id).length > 1 ? (
        <Card style={{ gap: spacing.sm }} testID="event-incident-card">
          <Body>
            This event is part of a connected incident (
            {events.filter((e) => e.scent_id === event.scent_id).length} events).
          </Body>
          <Button
            testID="event-incident-open"
            variant="secondary"
            label="View incident timeline"
            onPress={() =>
              router.push({
                pathname: "/patrol/scent/[id]",
                params: { id: event.scent_id! },
              })
            }
          />
        </Card>
      ) : null}

      {/* Footer */}
      <Text style={s.footer}>Together, Apollo and Higgins help you stay safer. 💙</Text>
      <Text style={s.buildInfo}>v{APP_VERSION} · {buildLabel()}</Text>
    </View>
  );
}
