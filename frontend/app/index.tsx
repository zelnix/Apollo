import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { ready, setupDone } = useApollo();
  const { colors } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }} testID="boot-loading">
        <ActivityIndicator color={colors.resting} />
      </View>
    );
  }
  return <Redirect href={setupDone ? "/(tabs)/home" : "/onboarding"} />;
}
