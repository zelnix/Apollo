// A reusable multi-select filter: a single "Filter" button (with a count badge) that opens a Sheet of
// toggleable options. Empty selection means "show everything". Used across the app in place of the old
// single-select pill rows so people can combine filters.
import Check from "lucide-react-native/icons/check";
import Funnel from "lucide-react-native/icons/funnel";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

export interface FilterOption {
  id: string;
  label: string;
}

const useStyles = makeStyles((c) => ({
  btn: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, alignSelf: "flex-start" },
  btnOn: { backgroundColor: c.brand, borderColor: c.brand },
  btnText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  btnTextOn: { color: "#FFFFFF" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.brand },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.border },
  rowLabel: { fontFamily: fonts.textMedium, fontSize: 16, color: c.onSurface },
  rowLabelOn: { fontFamily: fonts.textSemibold, color: c.brand },
}));

export function MultiSelectFilter({ options, selected, onChange, title = "Filter", allLabel = "Show all", testID }: {
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Button + sheet title, e.g. "Filter activity". */
  title?: string;
  /** Label for the row that clears every filter. */
  allLabel?: string;
  testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const count = selected.length;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}${count ? `, ${count} selected` : ""}`} onPress={() => setOpen(true)} style={[s.btn, count > 0 && s.btnOn]}>
        <Funnel size={16} color={count > 0 ? "#FFFFFF" : colors.onSurface} />
        <Text style={[s.btnText, count > 0 && s.btnTextOn]}>{title}</Text>
        {count > 0 ? <View style={s.badge}><Text style={s.badgeText}>{count}</Text></View> : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title} testID={`${testID}-sheet`}>
        <Pressable testID={`${testID}-all`} accessibilityRole="button" accessibilityState={{ selected: count === 0 }} style={s.row} onPress={() => onChange([])}>
          <Text style={[s.rowLabel, count === 0 && s.rowLabelOn]}>{allLabel}</Text>
          {count === 0 ? <Check size={20} color={colors.brand} /> : null}
        </Pressable>
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <Pressable key={o.id} testID={`${testID}-${o.id}`} accessibilityRole="button" accessibilityState={{ selected: on }} style={s.row} onPress={() => toggle(o.id)}>
              <Text style={[s.rowLabel, on && s.rowLabelOn]}>{o.label}</Text>
              {on ? <Check size={20} color={colors.brand} /> : null}
            </Pressable>
          );
        })}
        <Button testID={`${testID}-done`} label="Done" onPress={() => setOpen(false)} style={{ marginTop: spacing.lg }} />
      </Sheet>
    </>
  );
}
