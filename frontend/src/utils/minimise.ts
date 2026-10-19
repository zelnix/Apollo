// "Minimise Apollo" — protection runs natively (Site Guard / DNS filter) so the UI needn't stay open.
// Android can send the activity to the background; iOS has no API for this, so we guide the user.
import { BackHandler, Platform } from "react-native";

import type { ApolloState } from "@/src/domain/types";

export async function minimiseApp(showToast: (message: string, tone?: ApolloState | "neutral") => void): Promise<void> {
  if (Platform.OS === "android") {
    showToast("Apollo keeps guarding in the background.", "resting");
    setTimeout(() => BackHandler.exitApp(), 350);
    return;
  }
  showToast(Platform.OS === "ios" ? "Swipe up from the bottom to go Home — Apollo keeps guarding." : "Apollo keeps guarding — you can close this tab.", "resting");
}
