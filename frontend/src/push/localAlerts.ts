// Derive local notifications only from accepted device observations; never create an enforcement claim.
import { eventHasPacketProof } from "../domain/packetEvidence.ts";
import type { PatrolEvent } from "../domain/types";
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter";
import type { LocalAlert } from "./notifications";

export function eventLocalAlert(event: PatrolEvent): LocalAlert | null {
  if (event.status === "resolved" || event.status === "trusted") return null;
  if (!event.background && event.category !== "connection") return null;
  // Deep-link straight to this specific Patrol event (focus=alert pre-selects it so Higgins can answer
  // about exactly this finding) — never a generic tab (standing message requirement).
  const actionUrl = `/patrol/${encodeURIComponent(event.event_id)}?focus=alert`;
  if (event.state === "biting") {
    if (!event.verified_block || event.status !== "blocked" || !eventHasPacketProof(event)) return null;
    return { title: "Apollo is biting", body: event.headline, channel: "threats", actionUrl };
  }
  if (event.state === "barking") return { title: "Apollo is barking", body: event.headline, channel: "threats", actionUrl };
  if (event.state === "growling" || event.state === "ears_up") return { title: "Apollo is growling", body: event.headline, channel: "growling", actionUrl };
  return null;
}

export function protectionLocalAlert(previous: ProtectionStatus, observed: ProtectionStatus): LocalAlert | null {
  if (previous.operational === observed.operational || previous.requested !== observed.requested) return null;
  // Protection health is the Site Gate — deep-link straight to that gate's details, not the generic tab.
  if (observed.operational && observed.running && observed.lastVerified) return {
    title: "Apollo protection restored", body: "The device has confirmed protection is running again.", channel: "default", actionUrl: "/(tabs)/guard?gate=site",
  };
  if (observed.requested && !observed.operational) return {
    title: "Higgins: Protection needs attention", body: observed.degradedReason ?? "Apollo could not confirm website protection is running. Open the Site Gate to review it.", channel: "threats", actionUrl: "/(tabs)/guard?gate=site",
  };
  return null;
}