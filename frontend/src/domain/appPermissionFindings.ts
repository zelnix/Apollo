// App Gate — evidence-backed permission findings (pure, unit-tested). Replaces the blanket
// "More than it needs" with precise, verifiable statuses, distinguishing declared vs granted vs
// special-access vs unobservable. Granted evidence comes only from the native SDK; when the SDK can't
// see a permission the finding says so honestly — it never guesses "granted".
import type { AppPermission } from "./appAnalysis";
import type { SdkAppAssessment } from "@/src/security/appDeviceSdk";

export type PermissionAccess = "fits" | "enabled" | "not_allowed" | "requested_unverified" | "special_enabled" | "unavailable" | "reported";
export interface PermissionFinding { id: AppPermission; label: string; plain: string; expected: boolean; access: PermissionAccess; statusLabel: string; tone: "resting" | "ears_up" | "growling" | "neutral"; reviewRecommended: boolean; actionable: boolean }
export interface PermissionNoteLike { id: AppPermission; label: string; plain: string; expected: boolean }

const SPECIAL: Partial<Record<AppPermission, "display_over_other_apps" | "accessibility_service" | "notification_listener">> = {
  overlay: "display_over_other_apps", accessibility: "accessibility_service", notifications: "notification_listener",
};
// App-engine permission id → the SDK permission label names (reverse of appDeviceSdk SDK_PERMISSION_MAP).
const TO_SDK_NAMES: Partial<Record<AppPermission, string[]>> = {
  sms: ["Read SMS", "Receive SMS", "Send SMS"], contacts: ["Contacts"], camera: ["Camera"], microphone: ["Microphone"],
  location: ["Precise location", "Location"], calls: ["Call log", "Make calls", "Phone state"], install_apps: ["Install other apps"],
  files: ["Photos", "Files"], device_admin: ["Device admin"],
};

/** granted: true/false from native evidence, null = requested but state unknown, undefined = no native evidence at all. */
function grantedFor(id: AppPermission, sdk: SdkAppAssessment | null): boolean | null | undefined {
  if (!sdk) return undefined;
  const special = SPECIAL[id];
  if (special) { const st = sdk.specialAccessStates?.find((s) => s.access === special); return st ? st.granted : undefined; }
  const names = TO_SDK_NAMES[id] ?? [];
  const states = (sdk.permissionStates ?? []).filter((s) => names.includes(s.permission));
  if (!states.length) return undefined;
  if (states.some((s) => s.granted === true)) return true;
  if (states.every((s) => s.granted === false)) return false;
  return null;
}

export function buildPermissionFindings(notes: PermissionNoteLike[], sdk: SdkAppAssessment | null): PermissionFinding[] {
  return notes.map((n) => {
    const g = grantedFor(n.id, sdk);
    const special = !!SPECIAL[n.id];
    let access: PermissionAccess; let statusLabel: string; let reviewRecommended = false; let tone: PermissionFinding["tone"] = "resting";
    if (g === false) { access = "not_allowed"; statusLabel = "Access not allowed — No action needed"; tone = "resting"; }
    else if (g === true && special) { access = "special_enabled"; reviewRecommended = !n.expected; statusLabel = n.expected ? "Special access enabled — fits purpose" : "Special access enabled — Review recommended"; tone = n.expected ? "resting" : "growling"; }
    else if (g === true) { if (n.expected) { access = "fits"; statusLabel = "Access enabled — fits purpose"; tone = "resting"; } else { access = "enabled"; statusLabel = "Access enabled — Review recommended"; reviewRecommended = true; tone = "growling"; } }
    else if (g === null) { access = "requested_unverified"; reviewRecommended = !n.expected; statusLabel = "Permission requested — Access not verified"; tone = n.expected ? "neutral" : "ears_up"; }
    else if (sdk) { access = "unavailable"; statusLabel = "Current status unavailable"; tone = "neutral"; }
    else if (n.expected) { access = "reported"; statusLabel = "Reported by you — fits purpose"; tone = "resting"; }
    else { access = "reported"; statusLabel = "Reported by you — Review recommended"; reviewRecommended = true; tone = "growling"; }
    const actionable = ["enabled", "special_enabled", "requested_unverified", "reported"].includes(access) && reviewRecommended;
    return { id: n.id, label: n.label, plain: n.plain, expected: n.expected, access, statusLabel, tone, reviewRecommended, actionable };
  });
}

/** Diff two finding sets for the same app — returns permissions that moved from an enabled/granted
 *  state to "not allowed" (verified remediation) so the UI can confirm the change honestly. */
export function confirmedResolved(before: PermissionFinding[], after: PermissionFinding[]): PermissionFinding[] {
  const wasEnabled = new Set(before.filter((f) => f.access === "enabled" || f.access === "special_enabled").map((f) => f.id));
  return after.filter((f) => wasEnabled.has(f.id) && f.access === "not_allowed");
}
