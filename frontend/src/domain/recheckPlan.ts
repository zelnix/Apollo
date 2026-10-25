// What Apollo can honestly re-run for an existing case after the person has taken action.
// Pure: decides the route only from what the case recorded — it never claims a re-check is possible
// when the evidence or the live signal needed to run it isn't there.

import type { PatrolEvent } from "./types";

export type RecheckPlan =
  /** Apollo can re-run the full check here: detection → Triage → Magnum DI if Triage escalates. */
  | { kind: "link"; label: string; url: string }
  | { kind: "message"; label: string }
  | { kind: "number"; label: string; number: string }
  /** The live check lives in a Gate — open it and run it there. */
  | { kind: "gate"; label: string; route: string; note: string }
  /** Nothing can be re-run; the reason is stated. */
  | { kind: "none"; label: string; reason: string };

const GATE: Record<string, { label: string; route: string; note: string }> = {
  device: { label: "Re-check this device", route: "/device", note: "Apollo reads this device live, so the re-check runs in the Device check." },
  system: { label: "Re-check this device", route: "/device", note: "Apollo reads this device live, so the re-check runs in the Device check." },
  app: { label: "Re-check the app", route: "/app-check", note: "Apollo reads the app's current permissions, so the re-check runs in the App check." },
  connection: { label: "Re-check this connection", route: "/network", note: "Apollo reads the live connection, so the re-check runs in the Internet check." },
  account: { label: "Re-check my accounts", route: "/account-monitor", note: "ApolloSG re-queries the breach service in Check My Accounts." },
  file: { label: "Re-check the file", route: "/file", note: "ApolloSG needs the file again to inspect it, so the re-check runs in the File check." },
};

export function recheckPlan(event: PatrolEvent): RecheckPlan {
  const category = event.category;

  if (category === "link" || category === "website" || category === "known_threat" || category === "protection") {
    const url = event.local_indicator ?? event.source_metadata?.url
      ?? (event.indicator_host ? `https://${event.indicator_host}/` : null);
    if (url) return { kind: "link", label: "Re-check this website now", url };
    return { kind: "none", label: "Re-check", reason: "Apollo didn't record a link for this case, so there is nothing to re-check." };
  }

  if (category === "message" || category === "email") {
    return { kind: "message", label: "Re-check this message now" };
  }

  if (category === "call") {
    const number = event.local_indicator ?? event.source_metadata?.sender ?? null;
    if (number) return { kind: "number", label: "Re-check this number now", number };
    return { kind: "none", label: "Re-check", reason: "Apollo didn't record a number for this case, so there is nothing to re-check." };
  }

  const gate = GATE[category];
  if (gate) return { kind: "gate", ...gate };
  return { kind: "none", label: "Re-check", reason: "ApolloSG can't re-run this kind of check from the case record." };
}
