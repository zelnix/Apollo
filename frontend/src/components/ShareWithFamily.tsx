// "Send to family" on a threat: one tap sends linked family in Apollo a short summary, or opens the phone's
// share menu (a message, WhatsApp or an email). Only the summary goes — never the original message, links or pictures.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Share2 from "lucide-react-native/icons/share-2";
import Users from "lucide-react-native/icons/users";
import React from "react";
import { Share, Text, View } from "react-native";

import { apiGet, apiPost } from "@/src/api/client";
import { Button, Card } from "@/src/components/ui";
import { summaryText, summaryWire, type FamilySummary } from "@/src/domain/familySummary";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brandPrimary },
}));

export function ShareWithFamily({ summary, when }: { summary: FamilySummary; when: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { deviceId, showToast } = useApollo();
  const links = useQuery({
    queryKey: ["family-links", deviceId], enabled: !!deviceId,
    queryFn: () => apiGet<{ i_watch: unknown[]; watching_me: number }>(`/family/links?device_id=${deviceId}`),
  });
  const linked = (links.data?.i_watch.length ?? 0) + (links.data?.watching_me ?? 0);
  const send = useMutation({
    mutationFn: () => apiPost<{ shared_with: number }>("/family/threats/share", "family", { device_id: deviceId, ...summaryWire(summary) }),
    onSuccess: (r) => showToast(r.shared_with
      ? `Sent to ${r.shared_with === 1 ? "your family member" : `${r.shared_with} family members`} in ApolloSG.`
      : "No family is linked in ApolloSG yet.", r.shared_with ? "resting" : "neutral"),
    onError: () => showToast("ApolloSG couldn't send this to your family right now. Try again shortly.", "growling"),
  });
  const shareOther = async () => {
    try {
      await Share.share({ message: summaryText(summary, when), title: "ApolloSG threat summary" });
    } catch {
      showToast("ApolloSG couldn't open the share menu on this device.", "growling");
    }
  };
  const what = summary.involved ? `the ${summary.involved.label === "Website" ? "website" : "number"} involved` : null;

  return (
    <Card style={{ gap: spacing.sm }} testID="tc-share-family">
      <Text style={s.title}>Send to family</Text>
      <Text style={s.body}>
        They&apos;ll see the result, what happened{what ? `, what to do and ${what}` : " and what to do"}. Not the original message, its links or pictures.
      </Text>
      {linked > 0 ? (
        <Button
          testID="tc-share-family-send"
          label={send.isPending ? "Sending…" : "Send to family in ApolloSG"}
          icon={<Users size={18} color={colors.onBrandPrimary} />}
          onPress={() => send.mutate()}
          disabled={send.isPending || !deviceId}
        />
      ) : links.isSuccess ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }} testID="tc-share-family-none">
          <Text style={s.muted}>No family is linked in ApolloSG yet.</Text>
          <Text style={s.link} onPress={() => router.push("/family")} accessibilityRole="link" testID="tc-share-family-link">Link family</Text>
        </View>
      ) : null}
      <Button
        testID="tc-share-family-other"
        variant="secondary"
        label="Share another way"
        icon={<Share2 size={18} color={colors.onSurface} />}
        onPress={() => void shareOther()}
      />
    </Card>
  );
}
