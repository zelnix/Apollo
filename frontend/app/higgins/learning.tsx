import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Card, SectionTitle } from "@/src/components/ui";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const TOPICS = [
  { title: "Pause before acting", body: "Scams create urgency. Stop, close the message or call, and contact the organisation using an address or number you find yourself." },
  { title: "Keep codes private", body: "A verification code proves it is you. Banks, government agencies and support staff should not ask you to read one aloud or send it in a message." },
  { title: "Use official recovery", body: "If an account may be at risk, open the provider's app or type its official address yourself. Do not use a recovery link from the warning." },
  { title: "Check one thing at a time", body: "Use Check It for the exact message, link, file, call, app, account alert, device or network you want Apollo to examine." },
] as const;
const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, content: { paddingHorizontal: spacing.xl, gap: spacing.xl }, title: { fontFamily: fonts.displayBold, fontSize: 19, color: c.onSurface }, icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: c.navyTint } }));
export default function HigginsLearningScreen() { const s = useStyles(); const insets = useSafeAreaInsets(); const { colors } = useTheme(); return <View style={s.root} testID="higgins-learning-screen"><ChildScreenHeader title="Learn with Higgins" testID="higgins-learning-header" /><ScrollView testID="higgins-learning-scroll" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}><Card testID="higgins-learning-intro"><Body>Short, practical lessons for safer everyday decisions. These lessons are general guidance, not an investigation.</Body></Card><View style={{ gap: spacing.md }}><SectionTitle>Four habits that help</SectionTitle>{TOPICS.map((topic, index) => <Card key={topic.title} testID={`higgins-learning-topic-${index}`} style={{ gap: spacing.md }}><View style={s.icon}><ShieldCheck size={23} color={colors.brand} /></View><Text style={s.title}>{topic.title}</Text><Body>{topic.body}</Body></Card>)}</View></ScrollView></View>; }