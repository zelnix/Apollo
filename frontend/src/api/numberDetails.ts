// Number Details for a call's top card, asked once per number while the app runs. A failed read gives null (the card
// then shows nothing) and is asked again next time.
import * as Localization from "expo-localization";

import { apiPost } from "@/src/api/client";
import type { NumberDetailsData } from "@/src/domain/numberDetails";

const asked = new Map<string, Promise<NumberDetailsData | null>>();

export function getNumberDetails(number: string): Promise<NumberDetailsData | null> {
  const country = Localization.getLocales()[0]?.regionCode ?? null;
  const key = `${number.replace(/[^\d+]/g, "")}|${country ?? ""}`;
  const known = asked.get(key);
  if (known) return known;
  const pending = apiPost<NumberDetailsData>("/call/number-details", "number_details", { number, ...(country ? { country } : {}) })
    .catch(() => { asked.delete(key); return null; });
  asked.set(key, pending);
  return pending;
}
