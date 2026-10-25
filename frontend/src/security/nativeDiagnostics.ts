// Truthful native-bridge calls.
//
// A native read has three distinct outcomes and Apollo must never blur them:
//   • the module is ABSENT (Expo Go, browser, a build without it) → the host genuinely has no such
//     capability, so the caller's declared "nothing available here" value is the truth;
//   • the module is PRESENT and the call FAILED (threw, or returned something unreadable) → Apollo
//     does not know the answer. It must not be reported as "nothing found", "not blocked" or "clean",
//     so the call throws and the failure is recorded for Support/Admin diagnostics;
//   • the call SUCCEEDED → the parsed value.

export interface NativeFailureRecord {
  operation: string;
  detail: string;
  at: string;
}

const MAX_RECORDS = 20;
const failures: NativeFailureRecord[] = [];

/** Records a native capability failure so Support/Admin can see it instead of it vanishing. */
export function recordNativeFailure(operation: string, detail: string): void {
  failures.unshift({ operation, detail, at: new Date().toISOString() });
  if (failures.length > MAX_RECORDS) failures.length = MAX_RECORDS;
}

/** Most recent native capability failures, newest first. */
export function recentNativeFailures(): NativeFailureRecord[] {
  return [...failures];
}

export function clearNativeFailures(): void {
  failures.length = 0;
}

/** A native call that was attempted and failed — never a result. */
export class NativeCallFailed extends Error {
  code = "SC_NATIVE_CALL_FAILED";
  constructor(readonly operation: string, readonly detail: string) {
    super(`ApolloSG couldn't complete the native operation "${operation}": ${detail}`);
    this.name = "NativeCallFailed";
  }
}

/**
 * Calls a native JSON method.
 * @param operation native method name, used in diagnostics
 * @param fn the bound native method, or undefined when the module/method is absent on this host
 * @param whenAbsent the truthful value for a host that has no such capability
 * @throws NativeCallFailed when the method exists but could not produce a readable answer
 */
export async function nativeJson<T>(operation: string, fn: (() => Promise<string>) | undefined, whenAbsent: T): Promise<T> {
  if (!fn) return whenAbsent;
  let raw: string;
  try {
    raw = await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    recordNativeFailure(operation, detail);
    throw new NativeCallFailed(operation, detail);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const detail = "the native module returned a response ApolloSG couldn't read";
    recordNativeFailure(operation, detail);
    throw new NativeCallFailed(operation, detail);
  }
}
