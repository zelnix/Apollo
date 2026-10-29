// Number Details on a call's top card: Country · Line type · Original network, from built-in numbering-plan data.
// Supplementary: if they can't be read, nothing is shown.
import Globe from "lucide-react-native/icons/globe";
import Phone from "lucide-react-native/icons/phone";
import RadioTower from "lucide-react-native/icons/radio-tower";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { getNumberDetails } from "@/src/api/numberDetails";
import { NETWORK_NOTE, numberDetailItems, type NumberDetailItem, type NumberDetailsData } from "@/src/domain/numberDetails";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const ICON: Record<NumberDetailItem["id"], React.ComponentType<{ size: number; color: string }>> = {
  country: Globe, line_type: Phone, network: RadioTower,
};

const useStyles = makeStyles((c) => ({
  box: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  title: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary },
  rows: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm },
  item: { width: "50%", flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingRight: spacing.sm },
  itemText: { flex: 1, gap: 1 },
  label: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  value: { fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 24 },
}));

export function NumberDetails({ number, testID }: { number: string; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [read, setRead] = useState<{ number: string; details: NumberDetailsData | null } | null>(null);

  useEffect(() => {
    let live = true;
    void getNumberDetails(number).then((details) => { if (live) setRead({ number, details }); });
    return () => { live = false; };
  }, [number]);

  const loading = read?.number !== number;
  if (!loading && !read?.details) return null;
  const details = loading ? null : read?.details ?? null;

  return (
    <View style={s.box} testID={testID}>
      <Text style={s.title}>Number details</Text>
      {details ? (
        <>
          <View style={s.rows}>
            {numberDetailItems(details).map((item) => {
              const Icon = ICON[item.id];
              return (
                <View key={item.id} style={s.item} testID={`${testID}-${item.id}`}>
                  <Icon size={18} color={colors.onSurfaceSecondary} />
                  <View style={s.itemText}>
                    <Text style={s.label}>{item.label}</Text>
                    <Text style={s.value} numberOfLines={2}>{item.value}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          {details.network ? <Text style={s.note} testID={`${testID}-note`}>{NETWORK_NOTE}</Text> : null}
        </>
      ) : (
        <View style={s.loading} testID={`${testID}-loading`}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={s.note}>Reading the number’s details…</Text>
        </View>
      )}
    </View>
  );
}
