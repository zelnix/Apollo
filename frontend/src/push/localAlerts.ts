// Derive local notifications only from accepted device observations; never create an enforcement claim.
import { eventHasPacketProof } from "../domain/packetEvidence.ts";
import type { PatrolEvent } from "../domain/types";
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter";
import type { LocalAlert } from "./notifications";

export function eventLocalAlert(event: PatrolEvent): LocalAlert | null {
  if (event.status === "resolved" || event.status === "trusted") return null;
  if (!event.background && event.category !== "connection") return null;
  if (event.state === "biting") {
    if (!event.verified_block || event.status !== "blocked" || !eventHasPacketProof(event)) return null;
    return { title: "Apollo is biting", body: event.headline, channel: "threats", actionUrl: "/(tabs)/patrol" };
  }
  if (event.state === "barking") return { title: "Apollo is barking", body: event.headline, channel: "threats", actionUrl: "/(tabs)/patrol" };
  if (event.state === "growling" || event.state === "ears_up") return { title: "Apollo is growling", body: event.headline, channel: "growling", actionUrl: "/(tabs)/patrol" };
  return null;
}

export function protectionLocalAlert(previous: ProtectionStatus, observed: ProtectionStatus): LocalAlert | null {
  if (previous.operational === observed.operational || previous.requested !== observed.requested) return null;
  if (observed.operational && observed.running && observed.lastVerified) return {
    title: "Apollo protection restored", body: "The device has confirmed protection is running again.", channel: "default", actionUrl: "/(tabs)/guard",
  };
  if (observed.requested && !observed.operational) return {
    title: "Higgins: Protection needs attention", body: observed.degradedReason ?? "Apollo could not confirm protection is running. Check Gates.", channel: "threats", actionUrl: "/(tabs)/guard",
  };
  return null;
}