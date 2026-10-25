// Higgins' report, shared by Ask Higgins and a threat's Overview: the answer, then each section once
// (see src/domain/reportSections.ts). "What you can do" follows, from the screen that shows it.
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { scrubMessage } from "@/src/domain/messageVoice";
import { reusedLine } from "@/src/domain/checkedAgo";
import type { Report } from "@/src/domain/reportSections";
import type { SourceReference } from "@/src/investigation/types";
import { HigginsAvatar } from "@/src/components/HigginsAvatar";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  name: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  time: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  sectionHeader: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface, marginTop: spacing.md },
  finding: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  findingText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  severity: { fontFamily: fonts.textMedium, fontSize: 15, lineHeight: 22, color: c.onSurface },
  explain: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted, fontStyle: "italic", marginTop: 2 },
  source: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
}));

function SourceRow({ source, testID }: { source: SourceReference; testID: string }) {
  const s = useStyles();
  const kind = source.authority === "official" ? "Official platform/vendor source"
    : source.authority === "self_claimed" ? "Fetched from the destination itself — not independent" : "Search result — publisher not independently verified";
  return (
    <Pressable style={s.source} onPress={() => void WebBrowser.openBrowserAsync(source.url)} accessibilityRole="link" testID={testID}>
      <Text style={s.link}>{source.title || source.url}</Text>
      <Text style={s.muted}>{kind} · {scrubMessage(source.retrieval)}</Text>
      {source.reused ? <Text style={s.muted} testID={`${testID}-reused`}>{reusedLine(source.retrievedAt)}</Text> : null}
    </Pressable>
  );
}

export function ReportBody({ report, time, ids }: {
  report: Report;
  time: string | null;
  /** testID prefix: "inv" on Ask Higgins, "tc-overview" on a threat. */
  ids: string;
}) {
  const s = useStyles();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.header}>
        <HigginsAvatar size={48} />
        <View>
          <Text style={s.name}>Higgins</Text>
          {time ? <Text style={s.time}>{time}</Text> : null}
        </View>
      </View>

      {report.answer.map((para, i) => (
        <Text key={`a${i}`} style={s.body} testID={i === 0 ? `${ids}-answer` : `${ids}-answer-${i}`}>{scrubMessage(para)}</Text>
      ))}
      {report.severity ? <Text style={s.severity} testID={`${ids}-severity`}>{report.severity}</Text> : null}

      {report.found.length ? (
        <View testID={`${ids}-findings`}>
          <Text style={s.sectionHeader}>What was found</Text>
          {report.found.map((f, i) => (
            <View key={`f${i}`} style={s.finding} testID={`${ids}-finding-${i}`}>
              <Text style={s.findingText}>{scrubMessage(f.text)}</Text>
              {f.detail ? <Text style={s.muted}>{f.detail}</Text> : null}
              {f.explain ? <Text style={s.explain} testID={`${ids}-finding-${i}-explain`}>{f.explain}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {report.means.length ? (
        <View style={{ gap: spacing.xs }} testID={`${ids}-means`}>
          <Text style={s.sectionHeader}>What it means</Text>
          {report.means.map((para, i) => <Text key={`m${i}`} style={s.body}>{scrubMessage(para)}</Text>)}
        </View>
      ) : null}

      {report.more.map((section, i) => (
        <View key={`x${i}`} style={{ gap: spacing.xs }} testID={`${ids}-more-${i}`}>
          <Text style={s.sectionHeader}>{scrubMessage(section.title)}</Text>
          {section.paragraphs.map((para, j) => <Text key={`x${i}-${j}`} style={s.body}>{scrubMessage(para)}</Text>)}
        </View>
      ))}

      {report.uncertain.length ? (
        <View style={{ gap: spacing.xs }} testID={`${ids}-uncertainties`}>
          <Text style={s.sectionHeader}>What isn&apos;t certain</Text>
          {report.uncertain.map((line, i) => <Text key={`u${i}`} style={s.body}>{"•"} {scrubMessage(line)}</Text>)}
        </View>
      ) : null}

      {report.how.length || report.sources.length ? (
        <View style={{ gap: spacing.xs }} testID={`${ids}-how`}>
          <Text style={s.sectionHeader}>How Apollo checked</Text>
          {report.how.map((para, i) => <Text key={`h${i}`} style={s.body}>{scrubMessage(para)}</Text>)}
          {report.sources.length ? (
            <View testID={`${ids}-sources`}>
              {report.sources.map((source) => <SourceRow key={source.id} source={source} testID={`${ids}-source-${source.id}`} />)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
