/**
 * Native Protection Evidence — extends the Device Check Gate with OS/OEM
 * scam-protection capability detection and a classification intake interface.
 *
 * Architecture (matches developer instructions exactly):
 *
 * DETECTION LAYER — reports which native protections are present and enabled.
 *   - Google Phone caller ID & spam (Android/Pixel)
 *   - Samsung Smart Call (Samsung)
 *   - Carrier call filtering (T-Mobile, AT&T, Verizon)
 *   - Google Messages spam protection
 *   - Samsung Messages spam filtering
 *   - iOS: no public API exposes native call/message classification (rule 8)
 *
 * CLASSIFICATION INTAKE — a clean interface designed for future verified APIs.
 *   - Today: always returns { available: false } (rules 6, 7, 8, 10)
 *   - When a verified API is confirmed: returns the provider's classification
 *     with full attribution, triggering Apollo's existing investigation process
 *
 * ATTRIBUTION — a native classification is always recorded as that provider's
 *   finding, never Apollo's. (rule 4)
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not infer a scam classification from blocked calls, unknown numbers,
 *     or any indirect signal (rule 5)
 *   - Does not replace the device's native call screening or messaging protection (rule 9)
 *   - Does not assume any API is accessible without verification (rules 6, 7, 8)
 */

import { Platform } from "react-native";
import { getNativeModule } from "./nativeBridge";
import { nativeJson } from "./nativeDiagnostics";

// ────────────────────────────────────────────────────────────────────
// Types — Detection
// ────────────────────────────────────────────────────────────────────

export interface NativeProtectionProvider {
  /** Name as attributed to the provider (Google Phone, Samsung Smart Call, etc.) */
  provider: string;
  /** Android package name or iOS bundle ID */
  packageName: string;
  /** Is the provider's app/service installed on this device? */
  installed: boolean;
  /** Is this provider the current default handler for calls or messages? */
  isDefaultHandler: boolean;
  /** Human-readable feature description */
  feature: string;
  /** Whether Apollo can currently access this provider's scam classifications
   *  through a verified, supported public API. */
  classificationAccessible: boolean;
  /** Technical note explaining API availability status */
  note: string;
}

export interface NativeProtectionCapabilities {
  callProtection: NativeProtectionProvider[];
  messageProtection: NativeProtectionProvider[];
  defaultDialerPackage: string;
  defaultSmsPackage: string;
  platform: string;
  capturedAtMillis: number;
}

// ────────────────────────────────────────────────────────────────────
// Types — Classification Intake (future use)
// ────────────────────────────────────────────────────────────────────

/** A native scam classification received through a verified, supported API.
 *  This type exists for architectural completeness. Today, no provider exposes
 *  a verified interface, so this path is never reached. */
export interface NativeClassification {
  available: true;
  /** The provider that produced this classification (never Apollo). */
  provider: string;
  /** The provider's own classification label, exactly as reported. */
  classification: string;
  /** How confident the provider is (their own confidence, not ours). */
  confidence: "low" | "medium" | "high";
  /** The type of communication: call or message. */
  communicationType: "call" | "message";
  /** Provider-specific detail (phone number, sender ID, etc.) */
  subject: string;
  /** Raw data from the provider, preserved for evidence. */
  raw: unknown;
  /** When this classification was produced. */
  classifiedAt: string;
}

export interface NativeClassificationUnavailable {
  available: false;
  /** Why the classification is not available. */
  reason: string;
}

export type NativeClassificationResult = NativeClassification | NativeClassificationUnavailable;

// ────────────────────────────────────────────────────────────────────
// Detection — read what native protections are present
// ────────────────────────────────────────────────────────────────────

const EMPTY_CAPABILITIES: NativeProtectionCapabilities = {
  callProtection: [],
  messageProtection: [],
  defaultDialerPackage: "",
  defaultSmsPackage: "",
  platform: Platform.OS,
  capturedAtMillis: 0,
};

/** Detect which OS/OEM native scam-protection capabilities are present on this device.
 *  Returns installed providers, whether they're the default handler, and whether their
 *  classification is accessible through a verified API. */
export async function detectNativeProtection(): Promise<NativeProtectionCapabilities> {
  if (Platform.OS === "android") {
    const m = getNativeModule();
    if (!m) return EMPTY_CAPABILITIES;
    // A failed read THROWS (NativeCallFailed). It is never flattened into "no protections found" —
    // that would turn a broken read into a false "your device protects nothing". Callers decide
    // how to report the failure; every one of them already does.
    return await nativeJson<NativeProtectionCapabilities>(
      "getNativeProtectionCapabilities",
      () => m.getNativeProtectionCapabilities(),
      EMPTY_CAPABILITIES,
    );
  }

  // iOS: no public API exposes native call/message classification (rule 8).
  // We report the platform's built-in protections as detected but not accessible.
  if (Platform.OS === "ios") {
    return {
      callProtection: [
        {
          provider: "iOS Phone",
          packageName: "com.apple.mobilephone",
          installed: true,
          isDefaultHandler: true,
          feature: "Silence Unknown Callers & carrier-level STIR/SHAKEN",
          classificationAccessible: false,
          note: "Apple does not share its scam-call classification with any app, so Apollo cannot use it as evidence.",
        },
      ],
      messageProtection: [
        {
          provider: "iOS Messages",
          packageName: "com.apple.MobileSMS",
          installed: true,
          isDefaultHandler: true,
          feature: "Junk message filtering",
          classificationAccessible: false,
          note: "Apple does not share its junk-message classification with any app, so Apollo cannot use it as evidence.",
        },
      ],
      defaultDialerPackage: "com.apple.mobilephone",
      defaultSmsPackage: "com.apple.MobileSMS",
      platform: "ios",
      capturedAtMillis: Date.now(),
    };
  }

  // Web / other — no native protections to detect.
  return EMPTY_CAPABILITIES;
}

// ────────────────────────────────────────────────────────────────────
// Classification Intake — for future verified APIs
// ────────────────────────────────────────────────────────────────────

/** Attempt to read a native call scam classification for the given phone number.
 *
 *  TODAY: Always returns { available: false } because no verified public API
 *  has been confirmed for any provider (rules 6, 7, 8).
 *
 *  FUTURE: When a verified API is confirmed, this function will return the
 *  provider's actual classification with full attribution. */
export async function getNativeCallClassification(
  _phoneNumber: string,
): Promise<NativeClassificationResult> {
  // Rule 6: Android/Pixel — no verified public API for Google's scam verdict.
  // Rule 7: Samsung — no verified Samsung API for Smart Call verdict.
  // Rule 8: iOS — no supported public API for Apple's native scam classification.
  // Rule 10: Leave existing behaviour unchanged when classification is not accessible.
  return {
    available: false,
    reason: "No verified public API is currently available for reading native call scam classifications on this platform.",
  };
}

/** Attempt to read a native message scam classification for the given sender/message.
 *
 *  TODAY: Always returns { available: false } — same reasons as call classification. */
export async function getNativeMessageClassification(
  _sender: string,
): Promise<NativeClassificationResult> {
  return {
    available: false,
    reason: "No verified public API is currently available for reading native message scam classifications on this platform.",
  };
}

// ────────────────────────────────────────────────────────────────────
// Evidence builder — for when a classification IS received
// ────────────────────────────────────────────────────────────────────

/** Build a patrol-event–compatible evidence record from a native classification.
 *  Attribution rule: the provider's name, not Apollo's, is always recorded.
 *
 *  This function is called ONLY when `getNativeCallClassification` or
 *  `getNativeMessageClassification` returns `{ available: true }`.
 *  Today that never happens. */
export function buildNativeClassificationEvidence(classification: NativeClassification): {
  headline: string;
  what_happened: string;
  source_metadata: { type: string; subject: string; preview: string; provider: string; providerClassification: string };
  evidence_provenance: string;
} {
  const { provider, classification: label, communicationType, subject, classifiedAt } = classification;
  return {
    headline: `${provider} identified a ${label} ${communicationType}`,
    what_happened: `${provider}'s native protection classified this ${communicationType} as "${label}" at ${new Date(classifiedAt).toLocaleString()}. This is ${provider}'s finding — Apollo is presenting it, not making the claim.`,
    source_metadata: {
      type: communicationType,
      subject,
      preview: `${provider}: ${label}`,
      provider,
      providerClassification: label,
    },
    evidence_provenance: `native_protection:${provider.toLowerCase().replace(/\s+/g, "_")}`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Summary helpers for the Device Check Gate UI
// ────────────────────────────────────────────────────────────────────

/** Summarise native call protection for the Device Check Gate review. */
export function summariseCallProtection(caps: NativeProtectionCapabilities): {
  hasNativeProtection: boolean;
  activeProviders: string[];
  detail: string;
} {
  const active = caps.callProtection.filter((p) => p.installed && p.isDefaultHandler);
  const installed = caps.callProtection.filter((p) => p.installed);
  if (active.length > 0) {
    return {
      hasNativeProtection: true,
      activeProviders: active.map((p) => p.provider),
      detail: `Native call protection active: ${active.map((p) => p.provider).join(", ")}. ${active.every((p) => !p.classificationAccessible) ? "Classification is not accessible to Apollo through a supported API." : ""}`.trim(),
    };
  }
  if (installed.length > 0) {
    return {
      hasNativeProtection: false,
      activeProviders: [],
      detail: `${installed.map((p) => p.provider).join(", ")} installed but not the active call handler.`,
    };
  }
  return { hasNativeProtection: false, activeProviders: [], detail: "No known native call protection detected." };
}

/** Summarise native message protection for the Device Check Gate review. */
export function summariseMessageProtection(caps: NativeProtectionCapabilities): {
  hasNativeProtection: boolean;
  activeProviders: string[];
  detail: string;
} {
  const active = caps.messageProtection.filter((p) => p.installed && p.isDefaultHandler);
  const installed = caps.messageProtection.filter((p) => p.installed);
  if (active.length > 0) {
    return {
      hasNativeProtection: true,
      activeProviders: active.map((p) => p.provider),
      detail: `Native message protection active: ${active.map((p) => p.provider).join(", ")}. ${active.every((p) => !p.classificationAccessible) ? "Classification is not accessible to Apollo through a supported API." : ""}`.trim(),
    };
  }
  if (installed.length > 0) {
    return {
      hasNativeProtection: false,
      activeProviders: [],
      detail: `${installed.map((p) => p.provider).join(", ")} installed but not the active message handler.`,
    };
  }
  return { hasNativeProtection: false, activeProviders: [], detail: "No known native message protection detected." };
}
