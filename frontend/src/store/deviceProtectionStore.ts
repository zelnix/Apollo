// Device Protections assessment — one place that reads, groups, remembers and compares.
//
// Reuses the existing reader (`readDeviceCapabilityState`), then keeps the last real assessment so the
// next one can report what changed. Reassessment happens at the moments the platform offers —
// opening Apollo and returning to it (e.g. back from Settings) — at most once a minute, so there is
// no polling. A change stays "unopened" (Home banner + "Changed" tag) until the person opens that protection.
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { groupDeviceProtections, summariseDeviceProtections, type DeviceProtectionGroups, type DeviceProtectionsSummary } from "@/src/domain/deviceCapabilities";
import { diffProtectionSnapshots, protectionSnapshot, unseenChanges, type ProtectionChange, type ProtectionSnapshot } from "@/src/domain/deviceProtectionChanges";
import { readDeviceCapabilityState, type DeviceCapabilityReading } from "@/src/security/deviceCapabilityState";
import { storage } from "@/src/utils/storage";

const K = { snapshot: "apollo.deviceProtections.snapshot.v1", changes: "apollo.deviceProtections.changes.v1", seen: "apollo.deviceProtections.openedChanges.v1" };
/** Minimum gap between automatic reassessments. A person tapping "Check again" is never held back. */
export const REASSESS_EVERY_MS = 60 * 1000;
const KEEP_CHANGES_MS = 30 * 86_400_000;

export interface DeviceProtectionAssessment {
  reading: DeviceCapabilityReading;
  groups: DeviceProtectionGroups;
  summary: DeviceProtectionsSummary;
  /** Every remembered change, newest first. */
  changes: ProtectionChange[];
  /** Recent changes the person hasn't opened yet, newest first. */
  unseen: ProtectionChange[];
  assessedAt: string;
}

let current: DeviceProtectionAssessment | null = null;
let inFlight: Promise<DeviceProtectionAssessment> | null = null;
let opened: string[] | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await storage.getItem<string | null>(key, null);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

async function openedIds(): Promise<string[]> {
  if (!opened) opened = (await loadJson<string[]>(K.seen)) ?? [];
  return opened;
}

async function assess(force: boolean): Promise<DeviceProtectionAssessment> {
  const reading = await readDeviceCapabilityState(force);
  const groups = groupDeviceProtections(reading.view.deviceProtects);
  const summary = summariseDeviceProtections(groups, reading.hasNativeHost);
  let changes = (await loadJson<ProtectionChange[]>(K.changes)) ?? [];
  // Only a real reading of the device itself is remembered and compared — never a preview.
  if (reading.hasNativeHost) {
    const next = protectionSnapshot(reading.view.deviceProtects, reading.security, reading.readAt);
    const previous = await loadJson<ProtectionSnapshot>(K.snapshot);
    const found = previous ? diffProtectionSnapshots(previous, next) : [];
    const now = Date.parse(reading.readAt);
    changes = [...found, ...changes].filter((c) => now - Date.parse(c.at) <= KEEP_CHANGES_MS).slice(0, 40);
    await storage.setItem(K.snapshot, JSON.stringify(next));
    await storage.setItem(K.changes, JSON.stringify(changes));
  }
  const unseen = unseenChanges(changes, await openedIds(), Date.parse(reading.readAt));
  current = { reading, groups, summary, changes, unseen, assessedAt: reading.readAt };
  emit();
  return current;
}

/** The person opened this protection: its changes are no longer "new". */
export async function acknowledgeProtectionChanges(protectionId: string): Promise<void> {
  if (!current) return;
  const ids = current.unseen.filter((c) => c.protectionId === protectionId).map((c) => c.id);
  if (!ids.length) return;
  const remembered = new Set(current.changes.map((c) => c.id));
  opened = [...(await openedIds()).filter((id) => remembered.has(id)), ...ids];
  await storage.setItem(K.seen, JSON.stringify(opened));
  current = { ...current, unseen: current.unseen.filter((c) => c.protectionId !== protectionId) };
  emit();
}

/** Read and compare now. `force` re-reads the device even if a reading is a few seconds old. */
export function assessDeviceProtections(force = false): Promise<DeviceProtectionAssessment> {
  if (inFlight) return inFlight;
  inFlight = assess(force).finally(() => { inFlight = null; });
  return inFlight;
}

/** When Apollo last compared a real reading — survives restarts, so reopening doesn't re-run a fresh check. */
export async function lastAssessedAt(): Promise<string | null> {
  return current?.reading.hasNativeHost ? current.assessedAt : (await loadJson<ProtectionSnapshot>(K.snapshot))?.at ?? null;
}

/** Reassess unless this session already holds an assessment younger than REASSESS_EVERY_MS. */
export async function maybeReassess(now = Date.now()): Promise<DeviceProtectionAssessment | null> {
  const last = current ? await lastAssessedAt() : null;
  if (last && now - Date.parse(last) < REASSESS_EVERY_MS) return null;
  return assessDeviceProtections(true);
}

let started = false;
/** Reassess when Apollo opens or comes back to the foreground. */
export function startDeviceProtectionMonitor(): void {
  if (started) return;
  started = true;
  setTimeout(() => { void maybeReassess().catch(() => undefined); }, 1500);
  AppState.addEventListener("change", (state) => { if (state === "active") void maybeReassess().catch(() => undefined); });
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The current assessment, reading the device the first time a screen asks. */
export function useDeviceProtections(): DeviceProtectionAssessment | null {
  const value = useSyncExternalStore(subscribe, () => current, () => current);
  useEffect(() => { if (!current) void assessDeviceProtections().catch(() => undefined); }, []);
  return value;
}
