// Share intake: links shared from other apps (iOS Share Extension / Android
// ACTION_SEND via expo-share-intent) and the apollo://check?url= deep link
// both land on the Check screen. The native share module is optional: in
// Expo Go / web it is absent and only the deep link path is active.

import { useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";

import { useApollo } from "@/src/store/ApolloContext";

export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i) ?? text.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>"']*)?/i);
  return match ? match[0] : null;
}

export function ShareIntakeListener() {
  const router = useRouter();
  const { ready, setupDone } = useApollo();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  useEffect(() => {
    if (!ready || !setupDone || !hasShareIntent) return;
    const url = extractUrl(shareIntent.webUrl ?? shareIntent.text);
    resetShareIntent();
    if (url) router.push({ pathname: "/check", params: { url, source: "share" } });
  }, [ready, setupDone, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
