import { useRouter } from "expo-router";
import Search from "lucide-react-native/icons/search";
import Trash from "lucide-react-native/icons/trash";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { deleteInvestigation, listInvestigations, subscribeDeviceInvestigations, type DeviceInvestigationMeta } from "@/src/investigation/deviceStore";
import { deleteImageEvidenceFor } from "@/src/store/imageEvidence";
import { deleteOriginalSource } from "@/src/store/originalSource";
import { deleteReportProgress } from "@/src/store/reportProgress";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const FILTERS = [
  { key: "", label: "All" },
  { key: "completed", label: "Completed" },
] as const;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  list: { paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, gap: spacing.md },
  search: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 52, backgroundColor: c.surfaceSecondary },
  input: { flex: 1, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  chips: { gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center" as const, borderWidth: 1, borderColor: c.border, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary },
  deleteBtn: { position: "absolute" as const, right: spacing.sm, top: spacing.sm, padding: spacing.sm },
}));

export default function HigginsHistoryScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<DeviceInvestigationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DeviceInvestigationMeta | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void listInvestigations()
      .then((investigations) => {
        let filtered = investigations;
        if (status === "completed") filtered = filtered.filter((i) => i.status === "complete" || i.status === "partial");
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter((i) => i.headline.toLowerCase().includes(q) || i.assessment.toLowerCase().includes(q) || i.gates.some((g) => g.toLowerCase().includes(q)));
        }
        setItems(filtered);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [status, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeDeviceInvestigations(load), [load]);

  const open = (item: DeviceInvestigationMeta) => {
    router.push({ pathname: "/(tabs)/ask", params: { resumeCaseId: item.caseId } });
  };

  const remove = async () => {
    if (!selected) return;
    const item = selected;
    setSelected(null);
    await deleteInvestigation(item.caseId);
    await deleteImageEvidenceFor(item.caseId).catch(() => undefined);
    await deleteOriginalSource(item.caseId).catch(() => undefined);
    await deleteReportProgress(item.caseId).catch(() => undefined);
    load();
  };

  const renderItem = ({ item }: { item: DeviceInvestigationMeta }) => (
    <Card testID={`device-inv-${item.caseId}`} style={{ gap: spacing.sm }}>
      <View style={s.row}>
        <Text style={[s.title, { flex: 1 }]} numberOfLines={2}>{item.headline || "Investigation"}</Text>
        <Pill
          tone={item.attention === "critical" ? "barking" : item.attention === "elevated" ? "growling" : "resting"}
          label={item.assessment || item.status}
          testID={`device-inv-${item.caseId}-status`}
        />
      </View>
      <Body>Completed {new Date(item.completedAt).toLocaleDateString()} · {item.gates.length ? item.gates.map((g) => g.charAt(0).toUpperCase() + g.slice(1)).join(", ") : "Investigation"}</Body>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button testID={`device-inv-open-${item.caseId}`} variant="secondary" label="Open investigation" onPress={() => open(item)} style={{ flex: 1 }} />
        <Pressable testID={`device-inv-delete-${item.caseId}`} onPress={() => setSelected(item)} style={{ justifyContent: "center", paddingHorizontal: spacing.md }}>
          <Trash size={20} color={colors.barking} />
        </Pressable>
      </View>
    </Card>
  );

  return (
    <View style={s.root} testID="higgins-history-screen">
      <ChildScreenHeader title="Investigation history" testID="higgins-history-header" />
      <FlatList
        testID="higgins-history-list"
        data={items}
        keyExtractor={(item) => item.caseId}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + spacing.xl }]}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <Card testID="higgins-history-storage-notice">
              <Body>{"Completed investigations are stored on this device only. Apollo\u2019s server does not retain them."}</Body>
            </Card>
            <View style={s.search}>
              <Search size={20} color={colors.muted} />
              <TextInput
                testID="higgins-history-search"
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={load}
                placeholder="Search investigations"
                placeholderTextColor={colors.muted}
                style={s.input}
              />
              <Button testID="higgins-history-search-button" variant="ghost" label="Search" onPress={load} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {FILTERS.map((filter) => (
                <Pressable key={filter.key} testID={`higgins-history-filter-${filter.key || "all"}`} onPress={() => setStatus(filter.key)} style={[s.chip, status === filter.key && { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary }]}>
                  <Text style={s.title}>{filter.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        renderItem={renderItem}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator testID="higgins-history-loading" color={colors.brand} />
          ) : (
            <Card testID="higgins-history-empty"><Body>No completed investigations on this device.</Body></Card>
          )
        }
      />
      <Sheet visible={!!selected} onClose={() => setSelected(null)} title="Delete this investigation?" testID="higgins-history-delete-sheet">
        <Body>This permanently removes the complete investigation, all locally stored evidence and original source material from this device. This action cannot be undone.</Body>
        <Button testID="higgins-history-delete-confirm" variant="danger" label="Delete investigation" onPress={remove} />
        <Button testID="higgins-history-delete-cancel" variant="ghost" label="Keep it" onPress={() => setSelected(null)} />
      </Sheet>
    </View>
  );
}
