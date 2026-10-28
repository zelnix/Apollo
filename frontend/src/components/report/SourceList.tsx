// The sources Apollo used for an investigation's answer, each opening in the browser: shown on the Evidence tab,
// with what kind of source it is and how it was retrieved.
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { reusedLine } from "@/src/domain/checkedAgo";
import { scrubMessage } from "@/src/domain/messageVoice";
import type { SourceReference } from "@/src/investigation/types";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  source: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
}));

export function SourceList({ sources, ids }: { sources: SourceReference[]; ids: string }) {
  const s = useStyles();
  return (
    <View testID={`${ids}-sources`}>
      {sources.map((source) => {
        const testID = `${ids}-source-${source.id}`;
        const kind = source.authority === "official" ? "Official platform/vendor source"
          : source.authority === "self_claimed" ? "Fetched from the destination itself — not independent" : "Search result — publisher not independently verified";
        return (
          <Pressable key={source.id} style={s.source} onPress={() => void WebBrowser.openBrowserAsync(source.url)} accessibilityRole="link" testID={testID}>
            <Text style={s.link}>{source.title || source.url}</Text>
            <Text style={s.muted}>{kind} · {scrubMessage(source.retrieval)}</Text>
            {source.reused ? <Text style={s.muted} testID={`${testID}-reused`}>{reusedLine(source.retrievedAt)}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
