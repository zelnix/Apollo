import React from "react";
import { View } from "react-native";

import { AlertsButton } from "./AlertsButton";
import { InfoButton, type ScreenInfo } from "./InfoButton";
import { ScreenHeader } from "./ui";
import { makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles(() => ({
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

// Settings lives in the bottom tab bar, so root headers carry only their own actions.
export function RootScreenHeader({ title, testID, rightAccessory, leading, info }: { title: string; testID: string; rightAccessory?: React.ReactNode; leading?: React.ReactNode; info?: ScreenInfo }) {
  const s = useStyles();
  return <ScreenHeader title={title} testID={testID} leading={leading} right={<View style={s.actions}>{rightAccessory}<AlertsButton testID={`${testID}-alerts`} />{info ? <InfoButton info={info} testID={`${testID}-info`} /> : null}</View>} />;
}
