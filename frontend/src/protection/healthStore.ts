import { useSyncExternalStore } from "react";

import type { ProtectionHealthSnapshot } from "./healthTypes";

const IDS = ["site", "text", "call", "email", "link", "file", "app", "device", "account", "network"] as const;
const TITLES: Record<(typeof IDS)[number], string> = { site: "Site protection", text: "Text protection", call: "Call protection", email: "Email checks", link: "Link checks", file: "File checks", app: "App checks", device: "Device checks", account: "Account checks", network: "Network checks" };

let snapshot: ProtectionHealthSnapshot = {
  revision: 0, checkedAt: null, trigger: null, checking: false, capabilities: [], protection: null, permissions: [], network: null,
  gates: IDS.map((id) => ({ id, title: TITLES[id], state: "checking", checkedAt: null, source: "manual", scope: "Status is being prepared.", userAction: null })),
};
const listeners = new Set<() => void>();

export function protectionHealthSnapshot(): ProtectionHealthSnapshot { return snapshot; }
export function publishProtectionHealth(next: ProtectionHealthSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export function subscribeProtectionHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useProtectionHealth(): ProtectionHealthSnapshot {
  return useSyncExternalStore(subscribeProtectionHealth, protectionHealthSnapshot, protectionHealthSnapshot);
}