// Share intake: content shared from other apps (iOS Share Extension / Android ACTION_SEND via
// expo-share-intent) lands on the Share landing screen, which classifies it (link / message / email /
// account alert / file / screenshot) and offers alternatives. The native share module is optional:
// in Expo Go / web it is absent and only the apollo://share and apollo://check deep links are active.

import { useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";

import { useApollo } from "@/src/store/ApolloContext";
import { putShareIntake } from "./shareIntake";

export { extractUrl } from "./classifyShare";

export function ShareIntakeListener() {
  const router = useRouter();
  const { ready, setupDone } = useApollo();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ debug: false, resetOnBackground: true });

  useEffect(() => {
    if (!ready || !setupDone || !hasShareIntent) return;
    const hasPayload = !!(shareIntent.text || shareIntent.webUrl || shareIntent.files?.length);
    if (!hasPayload) { resetShareIntent(); return; }
    const intakeId = putShareIntake({
      text: shareIntent.text ?? null,
      webUrl: shareIntent.webUrl ?? null,
      files: (shareIntent.files ?? []).map((file) => ({ path: file.path, fileName: file.fileName ?? null, mimeType: file.mimeType ?? null, size: file.size ?? null })),
    });
    resetShareIntent();
    router.push({ pathname: "/share", params: { intakeId } });
  }, [ready, setupDone, hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
