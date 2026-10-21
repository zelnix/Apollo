/**
 * Settings → My Personal Data
 *
 * Local-only CRUD screen for managing the user's personal data profile.
 * This data never leaves the device — it is used only for on-device
 * privacy screening before artifacts are sent for external analysis.
 */
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { Sheet } from "@/src/components/Sheet";
import {
  addPersonalDataEntry,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  deletePersonalDataEntry,
  loadPersonalData,
  updatePersonalDataEntry,
  type PersonalDataCategory,
  type PersonalDataEntry,
} from "@/src/store/personalDataStore";
import {
  acceptSuggestion,
  dismissSuggestion,
  loadSuggestions,
  type PersonalDataSuggestion,
} from "@/src/store/personalDataLearning";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { CloseButton } from "@/src/components/CloseButton";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, flex: 1 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  notice: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.muted,
  },
  noticeStrong: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.resting,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    minHeight: 52,
  },
  entryContent: { flex: 1, gap: 2 },
  entryLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 15,
    color: c.onSurface,
  },
  entryValue: {
    fontFamily: fonts.text,
    fontSize: 14,
    color: c.onSurfaceSecondary,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontFamily: fonts.text,
    fontSize: 15,
    color: c.muted,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  // Form sheet
  formField: { gap: spacing.xs },
  formLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
  },
  formInput: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.text,
    fontSize: 16,
    color: c.onSurface,
    backgroundColor: c.surfaceSecondary,
    minHeight: 48,
  },
  formTextarea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  categoryPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: c.surfaceSecondary,
    minHeight: 48,
  },
  categoryText: {
    fontFamily: fonts.text,
    fontSize: 16,
    color: c.onSurface,
  },
  categoryOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    minHeight: 48,
    justifyContent: "center",
  },
  categoryOptionText: {
    fontFamily: fonts.textMedium,
    fontSize: 16,
    color: c.onSurface,
  },
  categoryHint: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.muted,
  },
  // Suggestion styles
  suggestionCard: {
    backgroundColor: c.ears_upTint,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.ears_up,
    padding: spacing.md,
    gap: spacing.sm,
  },
  suggestionHeader: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.ears_upText,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(229,162,26,0.18)",
    minHeight: 52,
  },
  suggestionContent: { flex: 1, gap: 2 },
  suggestionLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
  },
  suggestionValue: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  suggestionReason: {
    fontFamily: fonts.text,
    fontSize: 11,
    color: c.muted,
    fontStyle: "italic",
  },
  suggestionActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  suggBtnAdd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  suggBtnAddText: {
    fontFamily: fonts.textSemibold,
    fontSize: 12,
    color: c.onBrandPrimary,
  },
  suggBtnDismiss: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: c.surfaceTertiary,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  suggBtnDismissText: {
    fontFamily: fonts.textMedium,
    fontSize: 12,
    color: c.muted,
  },
}));

export default function PersonalDataScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [entries, setEntries] = useState<PersonalDataEntry[]>([]);
  const [suggestions, setSuggestions] = useState<PersonalDataSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formVisible, setFormVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PersonalDataEntry | null>(null);
  const [formCategory, setFormCategory] = useState<PersonalDataCategory>("name");
  const [formLabel, setFormLabel] = useState("");
  const [formValue, setFormValue] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [data, sugg] = await Promise.all([loadPersonalData(), loadSuggestions()]);
    setEntries(data);
    setSuggestions(sugg);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAdd = () => {
    setEditingEntry(null);
    setFormCategory("name");
    setFormLabel("");
    setFormValue("");
    setFormVisible(true);
  };

  const openEdit = (entry: PersonalDataEntry) => {
    setEditingEntry(entry);
    setFormCategory(entry.category);
    setFormLabel(entry.label);
    setFormValue(entry.value);
    setFormVisible(true);
  };

  const handleSave = async () => {
    if (!formValue.trim()) return;
    setSaving(true);
    try {
      if (editingEntry) {
        await updatePersonalDataEntry(editingEntry.id, {
          category: formCategory,
          label: formLabel,
          value: formValue,
        });
      } else {
        await addPersonalDataEntry(
          formCategory,
          formLabel || CATEGORY_LABELS[formCategory],
          formValue,
        );
      }
      setFormVisible(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (entry: PersonalDataEntry) => {
    if (Platform.OS === "web") {
      void deletePersonalDataEntry(entry.id).then(refresh);
      return;
    }
    Alert.alert(
      "Remove this entry?",
      `"${entry.label || entry.value}" will be removed from your personal data profile.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void deletePersonalDataEntry(entry.id).then(refresh),
        },
      ],
    );
  };

  // Suggestion handlers
  const handleAcceptSuggestion = async (suggestion: PersonalDataSuggestion) => {
    await addPersonalDataEntry(
      suggestion.category,
      suggestion.label,
      suggestion.value,
    );
    await acceptSuggestion(suggestion.id);
    await refresh();
  };

  const handleDismissSuggestion = async (suggestion: PersonalDataSuggestion) => {
    await dismissSuggestion(suggestion.id);
    await refresh();
  };

  // Group entries by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    entries: entries.filter((e) => e.category === cat),
  })).filter((g) => g.entries.length > 0);

  return (
    <View style={s.root} testID="personal-data-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} testID="personal-data-title">
          My Personal Data
        </Text>
        <CloseButton testID="personal-data-close" label="Close My Personal Data" onPress={() => goBackOrHome(router)} />
      </View>

      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        testID="personal-data-scroll"
      >
        {/* Privacy notice */}
        <Card testID="personal-data-notice">
          <Text style={s.notice}>
            <Text style={s.noticeStrong}>This data never leaves your device. </Text>
            Apollo uses it only to recognise your own personal information when
            screening artifacts before analysis. Only information that matches
            your profile is redacted — third-party details are preserved as
            evidence.
          </Text>
        </Card>

        {/* Add button */}
        <Button
          testID="personal-data-add"
          label="Add personal data"
          icon={<Plus size={18} color={colors.onBrandPrimary} />}
          onPress={openAdd}
        />

        {/* Auto-detected suggestions */}
        {suggestions.length > 0 ? (
          <View>
            <SectionTitle>Suggested for you</SectionTitle>
            <View style={s.suggestionCard} testID="personal-data-suggestions">
              <Body style={{ fontSize: 13 }}>
                Apollo detected these as likely personal data from your recent checks. Add them to protect your information, or dismiss.
              </Body>
              {suggestions.map((suggestion) => (
                <View key={suggestion.id} style={s.suggestionRow} testID={`suggestion-${suggestion.id}`}>
                  <View style={s.suggestionContent}>
                    <Text style={s.suggestionLabel} numberOfLines={1}>
                      {CATEGORY_LABELS[suggestion.category]}
                    </Text>
                    <Text style={s.suggestionValue} numberOfLines={2}>
                      {suggestion.value}
                    </Text>
                    <Text style={s.suggestionReason} numberOfLines={1}>
                      {suggestion.reason}
                    </Text>
                  </View>
                  <View style={s.suggestionActions}>
                    <Pressable
                      testID={`suggestion-add-${suggestion.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${suggestion.value}`}
                      onPress={() => void handleAcceptSuggestion(suggestion)}
                      style={s.suggBtnAdd}
                    >
                      <Text style={s.suggBtnAddText}>Add</Text>
                    </Pressable>
                    <Pressable
                      testID={`suggestion-dismiss-${suggestion.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Dismiss ${suggestion.value}`}
                      onPress={() => void handleDismissSuggestion(suggestion)}
                      style={s.suggBtnDismiss}
                    >
                      <Text style={s.suggBtnDismissText}>Dismiss</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Entries grouped by category */}
        {entries.length === 0 && !loading ? (
          <Text style={s.emptyText} testID="personal-data-empty">
            No personal data added yet.{"\n"}
            Add your names, phone numbers, email addresses and other personal
            identifiers so Apollo can protect them during analysis.
          </Text>
        ) : null}

        {grouped.map(({ category, entries: catEntries }) => (
          <View key={category}>
            <SectionTitle>{CATEGORY_LABELS[category]}s</SectionTitle>
            <Card testID={`personal-data-section-${category}`}>
              {catEntries.map((entry) => (
                <View key={entry.id} style={s.entryRow} testID={`personal-data-entry-${entry.id}`}>
                  <View style={s.entryContent}>
                    <Text style={s.entryLabel} numberOfLines={1}>
                      {entry.label || CATEGORY_LABELS[entry.category]}
                    </Text>
                    <Text style={s.entryValue} numberOfLines={2}>
                      {entry.value}
                    </Text>
                  </View>
                  <Pressable
                    testID={`personal-data-edit-${entry.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${entry.label}`}
                    onPress={() => openEdit(entry)}
                    style={s.actionBtn}
                    hitSlop={8}
                  >
                    <Pencil size={18} color={colors.onSurfaceSecondary} />
                  </Pressable>
                  <Pressable
                    testID={`personal-data-delete-${entry.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${entry.label}`}
                    onPress={() => handleDelete(entry)}
                    style={s.actionBtn}
                    hitSlop={8}
                  >
                    <Trash size={18} color={colors.barkingText} />
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>

      {/* Add / Edit Sheet */}
      <Sheet
        visible={formVisible}
        onClose={() => setFormVisible(false)}
        title={editingEntry ? "Edit personal data" : "Add personal data"}
        testID="personal-data-form-sheet"
      >
        {/* Category picker */}
        <View style={s.formField}>
          <Text style={s.formLabel}>Category</Text>
          <Pressable
            testID="personal-data-category-picker"
            style={s.categoryPicker}
            onPress={() => setCategoryPickerOpen(!categoryPickerOpen)}
          >
            <Text style={s.categoryText}>{CATEGORY_LABELS[formCategory]}</Text>
            <ChevronDown size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
          {categoryPickerOpen
            ? CATEGORY_ORDER.map((cat) => (
                <Pressable
                  key={cat}
                  testID={`personal-data-cat-${cat}`}
                  style={s.categoryOption}
                  onPress={() => {
                    setFormCategory(cat);
                    setCategoryPickerOpen(false);
                  }}
                >
                  <Text style={s.categoryOptionText}>
                    {CATEGORY_LABELS[cat]}
                  </Text>
                  <Text style={s.categoryHint}>{CATEGORY_HINTS[cat]}</Text>
                </Pressable>
              ))
            : null}
        </View>

        {/* Label */}
        <View style={s.formField}>
          <Text style={s.formLabel}>Label (optional)</Text>
          <TextInput
            testID="personal-data-label-input"
            style={s.formInput}
            value={formLabel}
            onChangeText={setFormLabel}
            placeholder={`e.g. "Home phone", "Work email"`}
            placeholderTextColor={colors.muted}
            autoCapitalize="sentences"
          />
        </View>

        {/* Value */}
        <View style={s.formField}>
          <Text style={s.formLabel}>Value</Text>
          <TextInput
            testID="personal-data-value-input"
            style={[
              s.formInput,
              (formCategory === "address" || formCategory === "email_signature") &&
                s.formTextarea,
            ]}
            value={formValue}
            onChangeText={setFormValue}
            placeholder={CATEGORY_HINTS[formCategory]}
            placeholderTextColor={colors.muted}
            multiline={
              formCategory === "address" || formCategory === "email_signature"
            }
            autoCapitalize={
              formCategory === "email" ? "none" : "sentences"
            }
            keyboardType={
              formCategory === "phone"
                ? "phone-pad"
                : formCategory === "email"
                  ? "email-address"
                  : "default"
            }
          />
        </View>

        <Button
          testID="personal-data-save"
          label={editingEntry ? "Save changes" : "Add"}
          onPress={() => void handleSave()}
          disabled={saving || !formValue.trim()}
        />
        <Button
          testID="personal-data-form-cancel"
          variant="ghost"
          label="Cancel"
          onPress={() => setFormVisible(false)}
        />
      </Sheet>

      {/* Category picker sheet (standalone for mobile) */}
      <Sheet
        visible={false}
        onClose={() => {}}
        title="Select category"
        testID="personal-data-category-sheet"
      >
        {null}
      </Sheet>
    </View>
  );
}
