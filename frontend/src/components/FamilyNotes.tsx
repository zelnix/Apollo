// "From your family": quick notes family sent back on a threat this person shared ("I'm calling you now" …).
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";

import { apiGet } from "@/src/api/client";
import { Card } from "@/src/components/ui";
import { formatDateTime } from "@/src/domain/threatCase";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing } from "@/src/theme";

export interface ThreatNote {
  note_id: string; event_id: string; guardian_label: string; kind: "calling" | "wait" | "custom"; text: string; created_at: string;
}

export const threatNotesPath = (eventId: string, deviceId: string) => `/family/shared-events/${eventId}/notes?device_id=${deviceId}`;

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  row: { gap: 2, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 21, color: c.onSurface },
  when: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));

export function FamilyNotes({ eventId }: { eventId: string }) {
  const s = useStyles();
  const { deviceId } = useApollo();
  const notes = useQuery({
    queryKey: ["threat-notes", eventId, deviceId], enabled: !!deviceId, refetchInterval: 30000,
    queryFn: () => apiGet<ThreatNote[]>(threatNotesPath(eventId, deviceId!)),
  });
  const list = [...(notes.data ?? [])].reverse();
  if (!list.length) return null;
  return (
    <Card style={{ gap: spacing.sm }} testID="tc-family-notes">
      <Text style={s.title}>From your family</Text>
      {list.map((n) => (
        <View key={n.note_id} style={s.row} testID={`tc-family-note-${n.note_id}`}>
          <Text style={s.name}>{n.guardian_label}</Text>
          <Text style={s.text}>{n.text}</Text>
          <Text style={s.when}>{formatDateTime(n.created_at)}</Text>
        </View>
      ))}
    </Card>
  );
}
