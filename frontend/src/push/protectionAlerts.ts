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

/** Notification for a completed background security check with meaningful results.
 *  Stage 12: routine resting/resolved checks are plumbing — only notify when the
 *  check produced an investigation-level finding the person needs to act on. */
export function completedCheckAlert(event: PatrolEvent): LocalAlert | null {
  if (!event.background) return null;
  // A completed Magnum DI investigation that returned to the device while the person
  // was away: this is genuinely meaningful — they asked for it or it escalated from triage.
  if (event.investigation_case_id && event.status === "resolved" && (event.state === "ears_up" || event.state === "growling" || event.state === "barking")) {
    return {
      title: "Apollo completed an investigation",
      body: event.headline || "Review the investigation result in Patrol.",
      channel: "apollo_alerts",
      actionUrl: `/patrol/${encodeURIComponent(event.event_id)}?focus=alert`,
    };
  }
  // Routine resting/resolved background checks are plumbing — no notification.
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
