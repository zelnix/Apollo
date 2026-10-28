// A completed "Check my device" is a case like any other: one patrol record, listed in Threats and
// kept in patrol history, opened and reported through the same threat-case screen.
//
// This builder is pure. It restates ONLY what the check actually produced — the briefing Higgins
// built from the review results. It never upgrades "couldn't determine" into a finding, and a check
// that found nothing is recorded as exactly that (resting, closed), not as a threat.

import type { ApolloState, PatrolEvent } from "./types";

export interface DeviceCheckBriefing {
  headline: string;
  findings: string[];
  action: string | null;
  /** "clear" | "review" | "action" | "error" — as produced by the device screen. */
  overall: string;
}

const STATE_FOR: Record<string, ApolloState> = {
  clear: "resting",
  review: "ears_up",
  action: "growling",
  error: "ears_up",
};

/** One device = one device-check case. Every recheck files its own patrol entry but shares this key,
 *  so Threats shows a single device-check case instead of one row per check. */
export const deviceCheckCaseKey = (deviceId: string | null): string => `device-check:${deviceId ?? "local"}`;

export function deviceCheckEvent(args: {
  eventId: string;
  deviceId: string | null;
  briefing: DeviceCheckBriefing;
  platformLabel: string;
  adapterLabel: string;
  checkedAt?: string;
}): PatrolEvent {
  const { eventId, deviceId, briefing, platformLabel, adapterLabel } = args;
  const checkedAt = args.checkedAt ?? new Date().toISOString();
  const state = STATE_FOR[briefing.overall] ?? "ears_up";
  const clear = briefing.overall === "clear";
  const failed = briefing.overall === "error";

  return {
    event_id: eventId,
    device_id: deviceId ?? "local",
    case_key: deviceCheckCaseKey(deviceId),
    category: "device",
    state,
    // A finished check — clear or not — stays open until the person closes it themselves.
    status: "active",
    headline: failed ? "Device check didn't run" : `Device check: ${briefing.headline}`,
    what_happened: failed
      ? "Apollo tried to check this device and the check did not complete. Nothing here says the device is clear."
      : `Apollo checked this device's security settings on ${new Date(checkedAt).toLocaleString()}. ${briefing.headline}.`,
    why: briefing.findings,
    what_to_do: briefing.action
      ? briefing.action
      : clear
        ? "Nothing to do. No concerns were found within what this device allows Apollo to check."
        : "Run the check again when you can, so ApolloSG has a complete reading.",
    indicator_host: null,
    indicator_digest: null,
    local_indicator: platformLabel,
    verified_block: false,
    adapter_label: adapterLabel,
    occurred_at: checkedAt,
    resolved_at: null,
    trust_allowed: false,
    background: false,
    origin: "user",
    evidence_provenance: "local_device",
    source_metadata: { type: "device", subject: `Device check — ${platformLabel}`, preview: briefing.headline },
  } as PatrolEvent;
}
