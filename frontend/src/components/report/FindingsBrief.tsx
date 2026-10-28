// The Findings Brief, shared by Ask Higgins and a Threat Case: the result Higgins Luddish gives from the Evidence
// Lock — Verdict → Key findings → What isn't certain → What you can do. A section shows only when it has something
// to say, and nothing is said twice. No investigation mechanics: how Apollo checked is on the DI tab, the sources it
// used on Evidence.
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleQuestionMark from "lucide-react-native/icons/circle-question-mark";
import Search from "lucide-react-native/icons/search";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { caseOutcome, caseSeverity } from "@/src/domain/caseBriefing";
import { isGeneralAnswer, luddishReport, luddishText } from "@/src/domain/luddish";
import { sentences } from "@/src/domain/luddish/patterns";
import { assessmentLabel, scrubMessage } from "@/src/domain/messageVoice";
import type { Report } from "@/src/domain/reportSections";
import { riskLevel } from "@/src/domain/threatCase";
import type { ApolloState } from "@/src/domain/types";
import type { HigginsResponse } from "@/src/investigation/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export type BriefTone = "barking" | "ears_up" | "sniffing" | "resting";
export interface BriefVerdict {
  /** Apollo's verdict ("Likely a scam"). None for an answer to a general question. */
  label: string | null;
  tone: BriefTone;
  /** How serious Apollo recorded it as ("High risk"), when that says something. */
  risk?: { label: string; color: string } | null;
  /** A caution the verdict must carry: a Limited result is never shown as safe. */
  caution?: string | null;
  /** The case's status on a threat ("Needs you", "Keeping watch"). */
  status?: { label: string; bg: string; fg: string } | null;
}
export interface BriefStep { id: string; text: string; onPress?: () => void }

/** "High risk" for the state Apollo recorded; nothing when there is no risk to state. */
export function riskPill(state: ApolloState | null | undefined): { label: string; color: string } | null {
  if (!state || state === "resting") return null;
  const risk = riskLevel(state);
  return risk.label === "Unknown" || risk.label === "None" ? null : { label: `${risk.label} risk`, color: risk.color };
}

/** An investigation's verdict and how serious it is, read from its Case Briefing (else what the result recorded) —
 *  the one place Ask Higgins and a threat read them from. An answer to a general question has no verdict. */
export function investigationVerdict(response: HigginsResponse): BriefVerdict {
  const { label, tone } = caseOutcome(response);
  return {
    label: label ?? (isGeneralAnswer(response) ? null : assessmentLabel(response.assessment)),
    tone: label ? tone : "sniffing",
    risk: riskPill(caseSeverity(response)),
  };
}

const ARTICLES = new Set(["a", "an", "the"]);
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !ARTICLES.has(w)).join(" ");

/** What the brief says, section by section, in Higgins' plain words: the verdict's short reason (never the verdict
 *  again), the key findings and what isn't certain. An answer to a general question is the answer itself. */
export function briefSections(report: Report, verdict: Pick<BriefVerdict, "label" | "caution">): { summary: string[]; findings: string[]; uncertain: string[] } {
  const r = luddishReport(report);
  const first = r.answer[0] ?? "";
  const label = verdict.label ? words(verdict.label) : null;
  const reason = label ? sentences(first).filter((x) => words(x) !== label).slice(0, 2).join(" ") : "";
  const summary = label
    ? [[reason, verdict.caution && !first.includes(verdict.caution) ? verdict.caution : ""].filter(Boolean).join(" ")].filter(Boolean)
    : r.answer;
  return {
    summary: summary.map(scrubMessage),
    findings: r.found.map((f) => scrubMessage(f.text)).filter(Boolean),
    uncertain: r.uncertain.map(scrubMessage).filter(Boolean),
  };
}

const useStyles = makeStyles((c) => ({
  section: { flexDirection: "row", gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, borderWidth: 0.25, borderColor: c.border },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  glyph: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, color: "#FFFFFF" },
  content: { flex: 1, gap: spacing.xs },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  risk: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  riskText: { fontFamily: fonts.textSemibold, fontSize: 12, color: "#FFFFFF" },
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  bullet: { flexDirection: "row", gap: spacing.sm },
  dot: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  item: { flex: 1, fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  link: { color: c.brandPrimary, fontFamily: fonts.textMedium },
}));

function Section({ bg, circle, icon, title, testID, children }: {
  bg: string; circle: string; icon: React.ReactNode; title?: string; testID: string; children: React.ReactNode;
}) {
  const s = useStyles();
  return (
    <View style={[s.section, { backgroundColor: bg }]} testID={testID}>
      <View style={[s.circle, { backgroundColor: circle }]}>{icon}</View>
      <View style={s.content}>
        {title ? <Text style={s.title}>{title}</Text> : null}
        {children}
      </View>
    </View>
  );
}

function Bullets({ items, testID }: { items: string[]; testID: string }) {
  const s = useStyles();
  return <>{items.map((text, i) => (
    <View key={`${i}-${text}`} style={s.bullet} testID={`${testID}-${i}`}>
      <Text style={s.dot}>{"\u2022"}</Text>
      <Text style={s.item}>{text}</Text>
    </View>
  ))}</>;
}

export function FindingsBrief({ report, verdict, steps, ids }: {
  report: Report; verdict: BriefVerdict; steps: BriefStep[];
  /** testID prefix: "inv" on Ask Higgins, "tc-overview" on a threat. */
  ids: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { summary, findings, uncertain } = useMemo(() => briefSections(report, verdict), [report, verdict]);
  const tone = {
    barking: { bg: colors.barkingTint, solid: colors.barking, ink: colors.barkingText, glyph: "!" },
    ears_up: { bg: colors.ears_upTint, solid: colors.ears_up, ink: colors.ears_upText, glyph: "!" },
    resting: { bg: colors.restingTint, solid: colors.resting, ink: colors.restingText, glyph: "\u2713" },
    sniffing: { bg: colors.sniffingTint, solid: colors.sniffing, ink: colors.sniffingText, glyph: "?" },
  }[verdict.tone];

  return (
    <View style={{ gap: spacing.md }} testID={`${ids}-brief`}>
      {verdict.label || summary.length ? (
        <Section bg={tone.bg} circle={tone.solid} icon={<Text style={s.glyph}>{tone.glyph}</Text>} testID={`${ids}-verdict`}>
          {/* Titled like every other card; the pills sit under the title so they never crowd it on a phone. */}
          <Text style={s.title}>
            {verdict.label ? <>{"Verdict: "}<Text style={{ color: tone.ink }} testID={`${ids}-verdict-label`}>{verdict.label}</Text></> : "Higgins' answer"}
          </Text>
          {verdict.risk || verdict.status ? (
            <View style={s.pills}>
              {verdict.risk ? (
                <View style={[s.risk, { backgroundColor: verdict.risk.color }]} testID={`${ids}-risk`}>
                  <Text style={s.riskText}>{verdict.risk.label}</Text>
                </View>
              ) : null}
              {verdict.status ? (
                <View style={[s.risk, { backgroundColor: verdict.status.bg }]} testID={`${ids}-status`}>
                  <Text style={[s.riskText, { color: verdict.status.fg }]}>{verdict.status.label}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {summary.map((para, i) => <Text key={`a${i}`} style={s.body} testID={i === 0 ? `${ids}-answer` : `${ids}-answer-${i}`}>{para}</Text>)}
        </Section>
      ) : null}

      {findings.length ? (
        <Section bg={colors.goldTint} circle={colors.ears_upTint} icon={<Search size={22} color={colors.ears_upText} />} title="Key findings" testID={`${ids}-findings`}>
          <Bullets items={findings} testID={`${ids}-finding`} />
        </Section>
      ) : null}

      {uncertain.length ? (
        <Section bg={colors.groupAccountsTint} circle={colors.groupAccountsTint} icon={<CircleQuestionMark size={22} color={colors.groupAccounts} />} title="What isn't certain" testID={`${ids}-uncertainties`}>
          <Bullets items={uncertain} testID={`${ids}-uncertain`} />
        </Section>
      ) : null}

      {steps.length ? (
        <Section bg={colors.restingTint} circle={colors.restingTint} icon={<ShieldCheck size={22} color={colors.restingText} />} title="What you can do" testID={`${ids}-todo`}>
          {steps.map((step) => {
            const text = luddishText(scrubMessage(step.text), true);
            return step.onPress ? (
              <Pressable key={step.id} style={({ pressed }) => [s.bullet, { minHeight: 44, alignItems: "center", opacity: pressed ? 0.7 : 1 }]} onPress={step.onPress}
                accessibilityRole="button" testID={`${ids}-action-${step.id}`}>
                <Text style={s.dot}>{"\u2022"}</Text>
                <Text style={[s.item, s.link]}>{text}</Text>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            ) : (
              <View key={step.id} style={s.bullet} testID={`${ids}-action-${step.id}`}>
                <Text style={s.dot}>{"\u2022"}</Text>
                <Text style={s.item}>{text}</Text>
              </View>
            );
          })}
        </Section>
      ) : null}
    </View>
  );
}
