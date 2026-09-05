import type { useRouter } from "expo-router";

/** Modal screens can be opened directly via deep link / share; fall back to Home when there is no history. */
export function goBackOrHome(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/home");
}
