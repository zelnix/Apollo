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
    const raw = shareIntent.webUrl ?? shareIntent.text ?? "";
    const url = extractUrl(raw);
    resetShareIntent();
    // A bare link → link check. Anything with more words than a link → Gate 2 message check (links are handed off from there).
    if (url && raw.trim().replace(url, "").trim().length < 12) router.push({ pathname: "/check", params: { url, source: "share" } });
    else if (raw.trim()) router.push({ pathname: "/message", params: { text: raw.trim().slice(0, 4000), source: "share" } });
  }, [ready, setupDone, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
