// One government feed on the Feed Health screen: source, status badge, last successful sync, records, last error.
import CircleAlert from "lucide-react-native/icons/circle-alert";
import React from "react";
import { Text, View } from "react-native";

import { Pill } from "@/src/components/ui";
import { contentTypeLabel, FEED_STATUS_LABEL, feedStatusTone, recordCountLabel, relativeAge, relayLabel, type FeedHealthRow as Row } from "@/src/domain/feedHealth";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  row: { paddingVertical: spacing.md, gap: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  titleWrap: { flex: 1, gap: 2 },
  source: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  type: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  fact: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  factStrong: { fontFamily: fonts.textMedium, color: c.onSurface },
  error: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.barkingTint },
  errorText: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.barkingText },
  errorCode: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
}));

export function FeedHealthRow({ feed, now, first }: { feed: Row; now: number; first?: boolean }) {
  const s = useStyles(); const { colors } = useTheme();
  const testID = `feed-health-row-${feed.feedId}`;
  return (
    <View style={[s.row, !first && s.divider]} testID={testID}>
      <View style={s.head}>
        <View style={s.titleWrap}>
          <Text style={s.source}>{feed.source}</Text>
          <Text style={s.type}>{contentTypeLabel(feed.contentType)}</Text>
        </View>
        <Pill compact tone={feedStatusTone(feed.status)} label={FEED_STATUS_LABEL[feed.status]} testID={`${testID}-status`} />
      </View>
      <Text style={s.fact} testID={`${testID}-last-sync`}>
        Last successful sync: <Text style={s.factStrong}>{relativeAge(feed.lastSuccessAt, now)}</Text>
      </Text>
      <Text style={s.fact} testID={`${testID}-records`}>{recordCountLabel(feed.recordCount)}</Text>
      {relayLabel(feed, now) ? <Text style={s.type} testID={`${testID}-relay`}>{relayLabel(feed, now)}</Text> : null}
      {feed.lastError ? (
        <View style={s.error} testID={`${testID}-error`}>
          <CircleAlert size={16} color={colors.barking} />
          <View style={{ flex: 1 }}>
            <Text style={s.errorText}>{feed.lastError.message}</Text>
            <Text style={s.errorCode}>
              {`Failed ${relativeAge(feed.lastError.at, now, "at an unknown time")}${feed.lastError.code ? ` · ${feed.lastError.code}${feed.lastError.detail ? `: ${feed.lastError.detail}` : ""}` : ""}`}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
