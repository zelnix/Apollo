import React from "react";
import { View } from "react-native";

import { InfoButton, type ScreenInfo } from "./InfoButton";
import { ScreenHeader } from "./ui";
import { makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles(() => ({
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

// Settings lives in the bottom tab bar, so root headers carry only their own actions.
export function RootScreenHeader({ title, testID, rightAccessory, info }: { title: string; testID: string; rightAccessory?: React.ReactNode; info?: ScreenInfo }) {
  const s = useStyles();
  return <ScreenHeader title={title} testID={testID} right={<View style={s.actions}>{rightAccessory}{info ? <InfoButton info={info} testID={`${testID}-info`} /> : null}</View>} />;
}
