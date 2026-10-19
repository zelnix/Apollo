import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { apiGet } from "@/src/api/client";
import { createFamilyHelpSession } from "@/src/family-help/api";
import type { CaptureScope } from "@/src/family-help/contracts";
import { FamilyHelpLayout } from "@/src/family-help/FamilyHelpLayout";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({ choice: { minHeight: 56, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, justifyContent: "center" }, selected: { borderColor: c.brandPrimary, backgroundColor: c.surfaceSecondary }, label: { fontFamily: fonts.textMedium, color: c.onSurface } }));
interface Watcher { link_id: string; guardian_label: string }
export default function StartFamilyHelp() {
  const s = useStyles(); const router = useRouter(); const { deviceId } = useApollo(); const [helper, setHelper] = useState<Watcher | null>(null); const [scope, setScope] = useState<CaptureScope>("full_display");
  const links = useQuery({ queryKey: ["family-help-watchers", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ watchers: Watcher[] }>(`/family/links?device_id=${deviceId}`) });
  const create = useMutation({ mutationFn: () => createFamilyHelpSession(helper!.link_id, deviceId!, scope, `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`), onSuccess: (row) => router.replace({ pathname: "/family/help/waiting", params: { sessionId: row.sessionId } }) });
  return <FamilyHelpLayout title="Ask for help"><SectionTitle>Who do you want to ask?</SectionTitle><View style={{ gap: spacing.sm }}>{(links.data?.watchers ?? []).map((row) => <Pressable key={row.link_id} testID={`family-help-helper-${row.link_id}`} accessibilityRole="button" style={[s.choice, helper?.link_id === row.link_id && s.selected]} onPress={() => setHelper(row)}><Text style={s.label}>{row.guardian_label}</Text></Pressable>)}</View><Card style={{ gap: spacing.md }} testID="family-help-scope-card"><SectionTitle>What will they see?</SectionTitle><Body>On iPhone and iPad, Apple’s broadcast picker chooses the screen. On Android, the system picker may offer one app or the full display.</Body><Pressable testID="family-help-scope-full" accessibilityRole="radio" accessibilityState={{ checked: scope === "full_display" }} style={[s.choice, scope === "full_display" && s.selected]} onPress={() => setScope("full_display")}><Text style={s.label}>My full screen</Text><Body>Apollo warns you before private information may appear.</Body></Pressable></Card><Button testID="family-help-send-invite" label={create.isPending ? "Sending…" : "Send help request"} disabled={!helper || !deviceId || create.isPending} onPress={() => create.mutate()} />{create.error ? <Body testID="family-help-create-error">{create.error.message}</Body> : null}</FamilyHelpLayout>;
}