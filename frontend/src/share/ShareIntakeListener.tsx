// Share intake: content shared from other apps (iOS Share Extension / Android ACTION_SEND via
// expo-share-intent) lands on the Share landing screen, which classifies it (link / message / email /
// account alert / file / screenshot) and offers alternatives. The native share module is optional:
// in Expo Go / web it is absent and only the apollo://share and apollo://check deep links are active.

import { useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";

import { useApollo } from "@/src/store/ApolloContext";

export { extractUrl } from "./classifyShare";

export function ShareIntakeListener() {
  const router = useRouter();
  const { ready, setupDone } = useApollo();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  useEffect(() => {
    if (!ready || !setupDone || !hasShareIntent) return;
    const file = shareIntent.files?.[0];
    const params: Record<string, string> = {};
    if (file) { params.fileUri = file.path; if (file.fileName) params.fileName = file.fileName; if (file.mimeType) params.mime = file.mimeType; if (file.size) params.size = String(file.size); }
    if (shareIntent.webUrl) params.url = shareIntent.webUrl;
    if (shareIntent.text) params.text = shareIntent.text.slice(0, 6000);
    resetShareIntent();
    if (Object.keys(params).length) router.push({ pathname: "/share", params });
  }, [ready, setupDone, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
