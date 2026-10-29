/**
 * Debug Logs — shows the investigation-flow diagnostic traces that are
 * POSTed to /api/debug/log from CallGuard, InvestigationFlow, and caseStore.
 *
 * Accessible from Settings → Diagnostics → Debug logs.
 * Provides: pull-to-refresh, tag filter, clear, and "Export as text" (Share/Clipboard).
 */
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Trash from "lucide-react-native/icons/trash";
import Upload from "lucide-react-native/icons/upload";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface LogEntry {
  ts: string;
  tag?: string;
  msg?: string;
  t?: number;
  [key: string]: unknown;
}

const TAGS = ["All", "CallGuard", "InvFlow", "caseStore"] as const;

const TAG_COLORS: Record<string, string> = {
  CallGuard: "#4A90D9",
  InvFlow: "#D97B4A",
  caseStore: "#6B8E23",
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  filters: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontFamily: fonts.textSemibold, fontSize: 12 },
  content: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: 40 },
  card: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  tag: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.5 },
  msg: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurface, marginTop: 1 },
  time: { fontFamily: fonts.text, fontSize: 10, color: c.muted },
  data: { fontFamily: fonts.mono ?? fonts.text, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary, marginTop: 4 },
  empty: { fontFamily: fonts.text, fontSize: 14, color: c.muted, textAlign: "center", paddingTop: 60 },
}));

export default function DebugLogsScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("All");

  const fetchLogs = useCallback(async () => {
    try {
      const r = await fetch("/api/debug/log?last=200");
      if (r.ok) setLogs(await r.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  const clearLogs = async () => {
    try { await fetch("/api/debug/log", { method: "DELETE" }); } catch { /* */ }
    setLogs([]);
  };

  const exportLogs = async () => {
    const visible = filtered();
    const text = visible.map((e) => {
      const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !["ts", "tag", "msg", "t"].includes(k)));
      return `[${e.ts}] [${e.tag ?? "?"}] ${e.msg ?? "?"}${Object.keys(rest).length ? " " + JSON.stringify(rest) : ""}`;
    }).join("\n");

    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", `${visible.length} log entries copied to clipboard.`);
  };

  const filtered = () => filter === "All" ? logs : logs.filter((e) => e.tag === filter);

  const formatTime = (entry: LogEntry) => {
    try {
      const d = new Date(entry.ts);
      return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, "0")}`;
    } catch { return entry.ts; }
  };

  const formatData = (entry: LogEntry) => {
    const skip = new Set(["ts", "tag", "msg", "t"]);
    const rest = Object.fromEntries(Object.entries(entry).filter(([k]) => !skip.has(k)));
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : null;
  };

  const visible = filtered();

  return (
    <View style={s.root} testID="debug-logs-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="debug-logs-back"
          onPress={() => goBackOrHome(router)}
          style={s.iconBtn}
        >
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Debug Logs</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Export logs" testID="debug-logs-export" onPress={() => void exportLogs()} style={s.iconBtn}>
          <Upload size={18} color={colors.brandPrimary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear logs" testID="debug-logs-clear" onPress={() => void clearLogs()} style={s.iconBtn}>
          <Trash size={18} color={colors.growling} />
        </Pressable>
      </View>

      {/* Tag filter chips */}
      <View style={s.filters}>
        {TAGS.map((tag) => (
          <Pressable
            key={tag}
            onPress={() => setFilter(tag)}
            style={[s.chip, {
              backgroundColor: filter === tag ? colors.brandPrimary : "transparent",
              borderColor: filter === tag ? colors.brandPrimary : colors.border,
            }]}
            testID={`debug-filter-${tag}`}
          >
            <Text style={[s.chipText, { color: filter === tag ? "#fff" : colors.onSurfaceSecondary }]}>{tag}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          testID="debug-logs-scroll"
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void fetchLogs()} tintColor={colors.brandPrimary} />}
        >
          {visible.length === 0 ? (
            <Text style={s.empty}>No logs yet.{"\n"}Run a call check and come back.</Text>
          ) : (
            [...visible].reverse().map((entry, i) => {
              const data = formatData(entry);
              const tagColor = TAG_COLORS[entry.tag ?? ""] ?? colors.onSurfaceSecondary;
              return (
                <View key={`${entry.ts}-${i}`} style={s.card} testID={`debug-log-${i}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={[s.tag, { color: tagColor }]}>{entry.tag ?? "?"}</Text>
                    <Text style={s.time}>{formatTime(entry)}</Text>
                  </View>
                  <Text style={s.msg}>{entry.msg ?? "?"}</Text>
                  {data ? <Text style={s.data} selectable>{data}</Text> : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
