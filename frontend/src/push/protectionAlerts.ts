// Apollo Local Notifications — Improvement 3: "Meaningful and Reassuring Notifications"
//
// Extends localAlerts.ts with protection work notifications:
// - Completed security checks
// - Protection updates installed
// - Threats detected and blocked
// - Protection recovery
// - Investigation outcomes
//
// All notifications use actual execution records and evidence.
// No notification is sent before the process actually completes.

import type { PatrolEvent } from "../domain/types";
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter";
import type { DailyActivity } from "../domain/dailyActivity";
import type { LocalAlert } from "./notifications";

/** Notification for a completed background security check with meaningful results. */
export function completedCheckAlert(event: PatrolEvent): LocalAlert | null {
  if (!event.background) return null; // Only notify for background (automatic) checks
  if (event.state === "resting" && event.category === "protection") return null; // Skip routine protection heartbeats

  // Completed check with no concerns
  if (event.state === "resting" || event.status === "resolved") {
    const actionUrl = `/patrol/${encodeURIComponent(event.event_id)}`;
    return {
      title: "Apollo completed a security check",
      body: event.headline || "No concerns were found in the areas examined.",
      channel: "default",
      actionUrl,
    };
  }

  return null;
}

/** Notification for a successfully installed protection intelligence update. */
export function protectionUpdateAlert(event: PatrolEvent): LocalAlert | null {
  if (event.category !== "protection") return null;
  if (!event.what_happened?.toLowerCase().includes("update")) return null;

  return {
    title: "Apollo updated your protection",
    body: event.headline || "Apollo successfully installed updated website security rules.",
    channel: "default",
    actionUrl: `/patrol/${encodeURIComponent(event.event_id)}`,
  };
}

/** Notification for verified recovery — protection was interrupted and is now restored.
 *  Only fires after actual observed recovery, never during fluctuation. */
export function recoveryAlert(previous: ProtectionStatus, current: ProtectionStatus): LocalAlert | null {
  // Only notify when transitioning from non-operational to operational
  if (previous.operational || !current.operational) return null;
  // Must be running and verified
  if (!current.running || !current.lastVerified) return null;

  return {
    title: "Apollo has restored protection",
    body: "Website protection is working again for supported connections.",
    channel: "default",
    actionUrl: "/(tabs)/protection",
  };
}

/** Daily summary notification — sent once per day if there was meaningful activity.
 *  Not sent for empty days or days with only routine heartbeats. */
export function dailySummaryAlert(activity: DailyActivity): LocalAlert | null {
  if (activity.eventCount === 0) return null;

  // Only send daily summary if something meaningful happened
  if (activity.threatsDetected === 0 && activity.checksCompleted === 0 && activity.updatesInstalled === 0) {
    return null;
  }

  return {
    title: "Apollo's Day on Patrol",
    body: activity.summary,
    channel: "default",
    actionUrl: "/(tabs)/patrol",
  };
}
