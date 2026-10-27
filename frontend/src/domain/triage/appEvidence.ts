// App evidence — Higgins Triage's classification of what ApolloSG had for an app: the details you entered, or the
// installed app's details read from this phone (package, installer, requested permissions, special access). Signing
// information and the store's or phone's own security checks aren't available to ApolloSG. Pure, no Expo imports.

import { APP_SOURCES, type AppAnalysis, type AppPermission, type AppSource } from "../appAnalysis.ts";
import { capability, fill, newProfile, typeWords, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type AppVia = "typed" | "picked" | "linked";

const WORDS = typeWords("app") as ReturnType<typeof typeWords> & { notes: Record<string, string>; signals: Record<string, string> };
export const APP_WORDS = WORDS;

/** What this phone's system said about the installed app (the shape of SdkAppAssessment that matters here). */
export interface AppDeviceRead {
  packageId: string; appName: string; developer: string | null; installSource: AppSource;
  requestedPermissions?: string[]; grantedPermissions?: string[]; remoteAccessCapability?: boolean;
  specialAccessStates?: { access: string; granted: boolean | null }[];
}

export interface AppEvidenceInput {
  via: AppVia;
  name: string;
  developer?: string | null;
  source: AppSource;
  /** Permissions the person ticked. */
  ticked: AppPermission[];
  device: AppDeviceRead | null;
  analysis: Pick<AppAnalysis, "remoteCapable" | "claimedBrand">;
  /** Destinations with a malicious reputation. */
  badDestinations?: number;
  at?: string;
}

const sourceLabel = (s: AppSource) => APP_SOURCES.find((x) => x.id === s)?.label ?? s;
const SIDELOADED = new Set<AppSource>(["browser", "message", "other_store"]);

export function buildAppProfile(input: AppEvidenceInput): EvidenceProfile {
  const d = input.device;
  const level = d ? "read_from_device" : "described";
  const entered = (input.developer ?? "").trim();
  const special = (access: string) => d?.specialAccessStates?.some((x) => x.access === access && x.granted === true) ?? false;
  const requested = d?.requestedPermissions ?? [];
  const granted = d?.grantedPermissions ?? [];
  const caps: CapabilityRow[] = [
    d ? capability("app", "app_name", "verified", d.appName, WORDS.notes.device) : capability("app", "app_name", "observed", input.name.trim(), WORDS.notes.entered),
    d ? capability("app", "package_id", "verified", d.packageId, WORDS.notes.device) : capability("app", "package_id", "unavailable", null, WORDS.notes.notRead),
    d?.developer ? capability("app", "developer", "recorded", d.developer, WORDS.notes.device)
      : entered ? capability("app", "developer", "observed", entered, WORDS.notes.entered)
      : capability("app", "developer", "unavailable", null, d ? WORDS.notes.device : WORDS.notes.missing),
    d ? capability("app", "install_source", "recorded", sourceLabel(d.installSource), WORDS.notes.installer)
      : input.source !== "not_sure" ? capability("app", "install_source", "observed", sourceLabel(input.source), WORDS.notes.entered)
      : capability("app", "install_source", "unavailable", null, WORDS.notes.missing),
    d ? capability("app", "permissions", "recorded", `${requested.length} requested${granted.length ? `, ${granted.length} granted` : ""}`, WORDS.notes.permissions)
      : input.ticked.length ? capability("app", "permissions", "observed", input.ticked.join(", ").replace(/_/g, " "), WORDS.notes.permissionsTicked)
      : capability("app", "permissions", "unavailable", null, WORDS.notes.notRead),
    capability("app", "version", "unavailable", null, WORDS.notes.version),
    capability("app", "signing", "unavailable", null, WORDS.notes.signing),
    capability("app", "store_security", "unavailable", null, WORDS.notes.store),
  ];
  const signals: EvidenceSignal[] = [];
  const source = d?.installSource ?? input.source;
  if (SIDELOADED.has(source)) signals.push({ id: "sideloaded", text: WORDS.signals.sideloaded });
  if (input.analysis.remoteCapable || d?.remoteAccessCapability) signals.push({ id: "remote_access", text: WORDS.signals.remote_access });
  if (special("accessibility_service")) signals.push({ id: "accessibility", text: WORDS.signals.accessibility });
  if (special("display_over_other_apps")) signals.push({ id: "overlay", text: WORDS.signals.overlay });
  if (special("notification_listener")) signals.push({ id: "notifications", text: WORDS.signals.notifications });
  if (input.analysis.claimedBrand) signals.push({ id: "brand_name", text: fill(WORDS.signals.brand_name, { brand: input.analysis.claimedBrand }) });
  const bad = input.badDestinations ?? 0;
  if (bad) signals.push({ id: "bad_destination", text: fill(WORDS.signals.bad_destination, { count: String(bad), plural: bad === 1 ? "" : "es" }) });
  return newProfile({ type: "app", level, via: input.via, at: input.at, capabilities: caps, signals });
}
