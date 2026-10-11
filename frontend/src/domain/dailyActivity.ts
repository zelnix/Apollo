// Apollo Daily Activity Summary — Improvement 2: "Show Evidence of a Job Well Done"
//
// Builds a concise daily summary from actual patrol events and protection records.
// All data must come from real execution records. No simulated activity.
// Pure, unit-testable: no React, no navigation.

import type { PatrolEvent } from "./patrolRecords";

export interface DailyActivity {
  /** Total significant events today */
  eventCount: number;
  /** Completed security checks (scans, investigations) */
  checksCompleted: number;
  /** Threats detected (growling or above) */
  threatsDetected: number;
  /** Threats verified blocked (biting with evidence) */
  threatsBlocked: number;
  /** Protection updates installed */
  updatesInstalled: number;
  /** Protection interruptions */
  interruptions: number;
  /** Protection recoveries */
  recoveries: number;
  /** Higgins summary paragraph (evidence-backed, no invented activity) */
  summary: string;
  /** Timestamp of last significant activity */
  lastActivityAt?: string;
  /** Whether any items need user action */
  actionNeeded: boolean;
}

/** Build a daily activity summary from today's patrol events.
 *  Only counts events from the current calendar day (device timezone).
 *  Never counts scheduled-but-unexecuted work or invents activity. */
export function buildDailyActivity(events: PatrolEvent[]): DailyActivity {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const todayEvents = events.filter((e) => {
    const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
    return ts >= todayMs;
  });

  let checksCompleted = 0;
  let threatsDetected = 0;
  let threatsBlocked = 0;
  let updatesInstalled = 0;
  let interruptions = 0;
  let recoveries = 0;
  let lastActivityAt: string | undefined;
  let actionNeeded = false;

  for (const ev of todayEvents) {
    const ts = ev.created_at ?? ev.updated_at;
    if (ts && (!lastActivityAt || ts > lastActivityAt)) {
      lastActivityAt = ts;
    }

    // Classify by event category and state
    if (ev.category === "protection" && ev.what_happened?.includes("update")) {
      updatesInstalled++;
    } else if (ev.category === "protection" && ev.what_happened?.includes("interrupt")) {
      interruptions++;
    } else if (ev.category === "protection" && ev.what_happened?.includes("restor")) {
      recoveries++;
    } else if (ev.verified_block) {
      threatsBlocked++;
      threatsDetected++;
    } else if (ev.state === "growling" || ev.state === "barking" || ev.state === "biting") {
      threatsDetected++;
    } else {
      checksCompleted++;
    }

    // Check if user action is needed
    if (ev.state === "barking" || ev.state === "growling") {
      if (!ev.resolved_at) actionNeeded = true;
    }
  }

  const eventCount = todayEvents.length;

  // Build the summary paragraph from actual activity
  const summary = buildSummaryText({
    checksCompleted,
    threatsDetected,
    threatsBlocked,
    updatesInstalled,
    interruptions,
    recoveries,
    eventCount,
    actionNeeded,
  });

  return {
    eventCount,
    checksCompleted,
    threatsDetected,
    threatsBlocked,
    updatesInstalled,
    interruptions,
    recoveries,
    summary,
    lastActivityAt,
    actionNeeded,
  };
}

function buildSummaryText(s: {
  checksCompleted: number;
  threatsDetected: number;
  threatsBlocked: number;
  updatesInstalled: number;
  interruptions: number;
  recoveries: number;
  eventCount: number;
  actionNeeded: boolean;
}): string {
  if (s.eventCount === 0) {
    return "Apollo has been on patrol today. No significant activity has been recorded yet.";
  }

  const parts: string[] = [];

  // Threats first (most important)
  if (s.threatsBlocked > 0) {
    parts.push(`stopped ${s.threatsBlocked} verified ${s.threatsBlocked === 1 ? "threat" : "threats"}`);
  }
  if (s.threatsDetected > s.threatsBlocked) {
    const detected = s.threatsDetected - s.threatsBlocked;
    parts.push(`detected ${detected} ${detected === 1 ? "concern" : "concerns"} that may need attention`);
  }

  // Checks
  if (s.checksCompleted > 0) {
    parts.push(`completed ${s.checksCompleted} security ${s.checksCompleted === 1 ? "check" : "checks"}`);
  }

  // Updates
  if (s.updatesInstalled > 0) {
    parts.push(`installed ${s.updatesInstalled} protection ${s.updatesInstalled === 1 ? "update" : "updates"}`);
  }

  // Recovery
  if (s.recoveries > 0) {
    parts.push(`restored protection ${s.recoveries} ${s.recoveries === 1 ? "time" : "times"}`);
  }

  if (parts.length === 0) {
    return "Apollo has been on patrol today. No concerns were found in the areas examined.";
  }

  const joined = parts.length === 1
    ? parts[0]
    : parts.length === 2
      ? `${parts[0]} and ${parts[1]}`
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const base = `Today, Apollo ${joined}.`;

  if (s.actionNeeded) {
    return `${base} Some findings need your attention.`;
  }
  if (s.threatsDetected === 0 && s.checksCompleted > 0) {
    return `${base} No concerns were found in the areas examined.`;
  }
  return base;
}
