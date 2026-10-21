/**
 * RetrofitModal — runs the historical record retrofit migration,
 * shows a Higgins-narrated report of what was done, and lets the user press OK.
 *
 * Usage:
 *   <RetrofitModal visible={show} onClose={() => setShow(false)} />
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import FileText from "lucide-react-native/icons/file-text";

import { apiGet, apiPostEmpty } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const RETROFIT_DONE_KEY = "apollo_retrofit_done_v1";

interface RetrofitReport {
  records_reviewed?: number;
  records_classified?: number;
  records_reclassified?: number;
  briefings_generated?: number;
  duplicates_marked?: number;
  legacy_marked?: number;
  by_class?: Record<string, number>;
  completed_at?: string;
  learning_catalogue?: { sources?: number; feeds?: number; articles?: number };
  learning_articles?: { articles_seeded?: number; articles_published?: number; articles_skipped?: number };
}

type Phase = "confirm" | "running" | "done" | "error" | "already_done";

/** Check if retrofit has already been run (stored locally). */
export async function hasRetrofitRun(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(RETROFIT_DONE_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

/** Mark the retrofit as completed locally. */
async function markRetrofitDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(RETROFIT_DONE_KEY, "true");
  } catch {
    // non-critical
  }
}

/** Build a Higgins-style report narrative from the enhancement stats. */
function buildHigginsReport(report: RetrofitReport): string {
  const lines: string[] = [];

  const reviewed = report.records_reviewed ?? 0;
  const classified = report.records_classified ?? 0;
  const reclassified = report.records_reclassified ?? 0;
  const briefings = report.briefings_generated ?? 0;
  const dupes = report.duplicates_marked ?? 0;
  const legacy = report.legacy_marked ?? 0;
  const articlesPublished = report.learning_articles?.articles_published ?? 0;
  const articlesSkipped = report.learning_articles?.articles_skipped ?? 0;

  const nothingRetrofitted = reviewed === 0;
  const nothingLearning = articlesPublished === 0 && articlesSkipped === 0;

  if (nothingRetrofitted && nothingLearning) {
    lines.push("I checked everything. All enhancements are already applied — no changes were needed.");
    return lines.join("\n\n");
  }

  // ── Investigation retrofit report ──
  if (reviewed > 0) {
    lines.push(`I've reviewed ${reviewed} investigation record${reviewed !== 1 ? "s" : ""} and applied the latest classification standards.`);

    if (classified > 0 || reclassified > 0) {
      const parts: string[] = [];
      if (classified > 0) parts.push(`${classified} newly classified`);
      if (reclassified > 0) parts.push(`${reclassified} reclassified with updated evidence standards`);
      lines.push(`Records updated: ${parts.join(", ")}.`);
    }

    if (briefings > 0) {
      lines.push(`I wrote ${briefings} new investigation briefing${briefings !== 1 ? "s" : ""} so you can understand what happened in each case.`);
    }

    if (dupes > 0) {
      lines.push(`${dupes} duplicate presentation record${dupes !== 1 ? "s were" : " was"} consolidated. The original evidence is preserved.`);
    }

    if (legacy > 0) {
      lines.push(`${legacy} older record${legacy !== 1 ? "s" : ""} couldn't be fully verified with current standards — they're marked as legacy but still visible.`);
    }
  }

  // ── Learn with Higgins articles ──
  if (articlesPublished > 0) {
    lines.push(`I've published ${articlesPublished} new Learn with Higgins article${articlesPublished !== 1 ? "s" : ""} — practical scam-safety guidance based on official Australian sources.`);
  } else if (articlesSkipped > 0) {
    lines.push("All Learn with Higgins articles are already up to date.");
  }

  lines.push("All enhancements have been applied. Everything is in order.");

  return lines.join("\n\n");
}

export function RetrofitModal({ visible, onClose, auto = false }: { visible: boolean; onClose: () => void; auto?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [report, setReport] = useState<RetrofitReport | null>(null);
  const [error, setError] = useState<string>("");

  const runRetrofit = useCallback(async () => {
    try {
      setPhase("running");
      const result = await apiPostEmpty<RetrofitReport>("/enhancements/run", "enhancements-run-v1");
      setReport(result);
      await markRetrofitDone();
      setPhase("done");
    } catch (err: any) {
      if (auto) {
        // Auto mode: silently close on failure — user can retry from Settings
        onClose();
        return;
      }
      setError(err?.message ?? "Something went wrong during the retrofit.");
      setPhase("error");
    }
  }, [auto, onClose]);

  useEffect(() => {
    if (!visible) return;

    // Reset state when modal opens
    setReport(null);
    setError("");

    // Check if already done
    (async () => {
      try {
        if (auto) {
          const done = await hasRetrofitRun();
          if (done) {
            setPhase("already_done");
            return;
          }
        }
        const status = await apiGet<{ status: string; report?: RetrofitReport }>("/enhancements/status");
        if (status.status === "completed") {
          await markRetrofitDone();
          setPhase("already_done");
          return;
        }
        if (auto) {
          // Auto mode: skip confirmation, start immediately
          setPhase("running");
          try {
            const result = await apiPostEmpty<RetrofitReport>("/enhancements/run", "enhancements-run-v1");
            setReport(result);
            await markRetrofitDone();
            setPhase("done");
          } catch {
            // Auto mode: silently close on failure
            onClose();
          }
          return;
        }
        // Manual mode: show confirmation screen
        setPhase("confirm");
      } catch {
        if (auto) { onClose(); return; }
        setPhase("confirm");
      }
    })();
  }, [visible, auto, onClose]);

  // If auto mode and already done, close silently
  useEffect(() => {
    if (phase === "already_done" && auto) {
      onClose();
    }
  }, [phase, auto, onClose]);

  if (!visible || (phase === "already_done" && auto)) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      testID="retrofit-modal"
    >
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Confirm phase — explain enhancements, user taps to start */}
          {phase === "confirm" ? (
            <ScrollView style={s.reportScroll} contentContainerStyle={s.reportContent}>
              <View style={s.reportHeader}>
                <View style={s.reportIconWrap}>
                  <ShieldCheck size={24} color="#FFFFFF" fill={colors.brand} />
                </View>
                <Text style={s.reportTitle}>Retrofit new enhancements</Text>
              </View>
              <Text style={s.loadingDesc}>
                Apollo has new enhancements ready to apply to your investigation history. Here's what will be updated:
              </Text>
              <View style={s.enhancementList}>
                <View style={s.enhancementItem}>
                  <Text style={s.enhancementBullet}>•</Text>
                  <Text style={s.enhancementText}>Evidence-based classification — every past investigation gets reclassified using the latest approved standards</Text>
                </View>
                <View style={s.enhancementItem}>
                  <Text style={s.enhancementBullet}>•</Text>
                  <Text style={s.enhancementText}>Higgins briefings — new investigation summaries written for each case so you can understand what happened</Text>
                </View>
                <View style={s.enhancementItem}>
                  <Text style={s.enhancementBullet}>•</Text>
                  <Text style={s.enhancementText}>Duplicate consolidation — repeated presentation records are merged while preserving all original evidence</Text>
                </View>
                <View style={s.enhancementItem}>
                  <Text style={s.enhancementBullet}>•</Text>
                  <Text style={s.enhancementText}>Legacy marking — older records that can't be fully verified are clearly labelled</Text>
                </View>
              </View>
              <Text style={s.enhancementNote}>
                This is safe to run and won't delete any of your data. Original evidence is always preserved.
              </Text>
              <Pressable
                testID="retrofit-start"
                style={[s.okButton, { backgroundColor: colors.brand }]}
                onPress={() => void runRetrofit()}
                accessibilityRole="button"
                accessibilityLabel="Start retrofit"
              >
                <Text style={s.okButtonText}>Start retrofit</Text>
              </Pressable>
              <Pressable
                testID="retrofit-cancel"
                style={s.cancelButton}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={[s.cancelButtonText, { color: colors.onSurfaceSecondary }]}>Not now</Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {/* Running phase */}
          {phase === "running" ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={s.loadingTitle}>Retrofitting new enhancements</Text>
              <Text style={s.loadingDesc}>
                Higgins is reviewing your investigation records and applying the latest reporting standards. This may take a moment.
              </Text>
            </View>
          ) : null}

          {/* Done phase — Higgins report */}
          {phase === "done" && report ? (
            <ScrollView style={s.reportScroll} contentContainerStyle={s.reportContent}>
              <View style={s.reportHeader}>
                <View style={s.reportIconWrap}>
                  <ShieldCheck size={24} color="#FFFFFF" fill={colors.resting} />
                </View>
                <Text style={s.reportTitle}>Enhancements applied</Text>
              </View>
              <View style={s.higginsWrap}>
                <View style={s.higginsAvatar}>
                  <FileText size={16} color={colors.gold} />
                </View>
                <Text style={s.higginsLabel}>Higgins report</Text>
              </View>
              <Text style={s.reportText}>{buildHigginsReport(report)}</Text>
              <Pressable
                testID="retrofit-ok"
                style={[s.okButton, { backgroundColor: colors.brand }]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="OK"
              >
                <Text style={s.okButtonText}>OK</Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {/* Already done (manual trigger) */}
          {phase === "already_done" && !auto ? (
            <View style={s.loadingWrap}>
              <View style={s.reportIconWrap}>
                <ShieldCheck size={24} color="#FFFFFF" fill={colors.resting} />
              </View>
              <Text style={s.loadingTitle}>Already up to date</Text>
              <Text style={s.loadingDesc}>
                Your investigation records are already using the latest reporting format. No changes needed.
              </Text>
              <Pressable
                testID="retrofit-ok-already"
                style={[s.okButton, { backgroundColor: colors.brand }]}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={s.okButtonText}>OK</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Error phase */}
          {phase === "error" ? (
            <View style={s.loadingWrap}>
              <Text style={s.loadingTitle}>Enhancement update</Text>
              <Text style={s.loadingDesc}>{error || "Could not complete the update. You can try again from Settings."}</Text>
              <Pressable
                testID="retrofit-ok-error"
                style={[s.okButton, { backgroundColor: colors.brand }]}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={s.okButtonText}>OK</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg,
    width: "100%", maxHeight: "80%",
    overflow: "hidden",
  },
  loadingWrap: {
    padding: spacing["2xl"], alignItems: "center", gap: spacing.lg,
  },
  loadingTitle: {
    fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, textAlign: "center",
  },
  loadingDesc: {
    fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary, textAlign: "center",
  },
  reportScroll: { maxHeight: 500 },
  reportContent: { padding: spacing["2xl"], gap: spacing.lg },
  reportHeader: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  reportIconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.restingTint,
    alignItems: "center", justifyContent: "center",
  },
  reportTitle: {
    fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1,
  },
  higginsWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
  },
  higginsAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: c.goldTint,
    alignItems: "center", justifyContent: "center",
  },
  higginsLabel: {
    fontFamily: fonts.displayBold, fontSize: 14, color: c.gold,
  },
  reportText: {
    fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface,
  },
  okButton: {
    borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center",
    marginTop: spacing.sm,
  },
  okButtonText: {
    fontFamily: fonts.displayBold, fontSize: 16, color: "#FFFFFF",
  },
  cancelButton: {
    paddingVertical: spacing.md, alignItems: "center",
  },
  cancelButtonText: {
    fontFamily: fonts.textMedium, fontSize: 15,
  },
  enhancementList: {
    gap: spacing.sm,
  },
  enhancementItem: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
  },
  enhancementBullet: {
    fontFamily: fonts.displayBold, fontSize: 15, color: c.brand, marginTop: 1,
  },
  enhancementText: {
    fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, flex: 1,
  },
  enhancementNote: {
    fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary, fontStyle: "italic",
  },
}));
