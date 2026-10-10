/**
 * Image Sanitization Receipt — on-device proof that an image passed through
 * the privacy gate before transmission.
 *
 * Package 4 requirements:
 * - Receipt digest is SHA-256 of the ACTUAL BINARY BYTES selected for upload
 * - One-time-use, 5-minute expiry, cancellation safeguards preserved
 * - Withheld images are blocked at the pipeline level
 * - Receipt cannot authorise a different image, an original, or altered content
 * - Missing bytes reject approval (no fallback digest)
 *
 * Trust boundary: The receipt is a client-side approval assertion. The backend
 * validates client-supplied metadata (sanitizationStatus, decision, digest) but
 * cannot independently verify that on-device screening was correctly performed.
 * This is an honest architectural limitation, not proof of completed screening.
 */

import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";

export type SanitizationDecision =
  | "text_only"       // Image never transmitted; extracted text used instead
  | "sanitised_image" // Pixel-level redacted image transmitted
  | "manual_crop"     // User-cropped image transmitted
  | "withheld"        // Nothing transmitted
  | "no_sensitive";   // No sensitive content detected; metadata-stripped image approved

export interface SanitizationReceipt {
  receiptId: string;
  /** SHA-256 hex digest of the actual binary image bytes selected for upload.
   *  For text_only/withheld: digest of the decision string (no image bytes). */
  imageDigest: string;
  decision: SanitizationDecision;
  sensitiveRegionsFound: number;
  redactedRegions: number;
  timestamp: number;
  consumed: boolean;
  /** Processing purpose for which this image was approved. */
  purpose: string;
  /** Transformations applied before approval (for consent recording). */
  transformations: string[];
  /** Any investigative limitations introduced by privacy processing. */
  limitations: string[];
}

/** In-memory receipt store. Receipts never persist to disk. */
const receipts = new Map<string, SanitizationReceipt>();

/** Decode Base64 to actual binary bytes. */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Convert ArrayBuffer to hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute SHA-256 digest of actual image bytes from a file URI.
 * Hashes the raw binary content (not its Base64 representation).
 * Returns null if bytes cannot be read — the image must be withheld.
 */
async function digestImageBytes(
  imageUri: string,
): Promise<{ digest: string; base64: string } | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64 || base64.length === 0) {
      return null;
    }
    const bytes = base64ToBytes(base64);
    const hashBuffer = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      bytes as unknown as ArrayBuffer,
    );
    return { digest: bufferToHex(hashBuffer), base64 };
  } catch {
    return null;
  }
}

/**
 * Create a sanitization receipt after the user makes a decision in the privacy gate.
 *
 * For image decisions (sanitised_image, manual_crop, no_sensitive):
 *   The digest is SHA-256 of the actual transformed binary bytes.
 *   Returns null if bytes cannot be read — the image must be withheld.
 *
 * For non-image decisions (text_only, withheld):
 *   The digest is SHA-256 of the decision string (no image bytes involved).
 */
export async function createReceipt(
  imageUri: string | null,
  decision: SanitizationDecision,
  sensitiveRegionsFound: number,
  redactedRegions: number,
  options?: {
    purpose?: string;
    transformations?: string[];
    limitations?: string[];
  },
): Promise<SanitizationReceipt | null> {
  const receiptId = Crypto.randomUUID();

  let imageDigest: string;
  if (decision === "text_only" || decision === "withheld" || !imageUri) {
    imageDigest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `no-image:${decision}:${receiptId}`,
    );
  } else {
    const result = await digestImageBytes(imageUri);
    if (result === null) {
      return null;
    }
    imageDigest = result.digest;
  }

  const receipt: SanitizationReceipt = {
    receiptId,
    imageDigest,
    decision,
    sensitiveRegionsFound,
    redactedRegions,
    timestamp: Date.now(),
    consumed: false,
    purpose: options?.purpose ?? "investigation",
    transformations: options?.transformations ?? [],
    limitations: options?.limitations ?? [],
  };
  receipts.set(receiptId, receipt);
  setTimeout(() => receipts.delete(receiptId), 5 * 60 * 1000);
  return receipt;
}

/** Consume a receipt (one-time use). Returns null if invalid, expired, or already consumed. */
export function consumeReceipt(receiptId: string): SanitizationReceipt | null {
  const receipt = receipts.get(receiptId);
  if (!receipt || receipt.consumed) return null;
  if (Date.now() - receipt.timestamp > 5 * 60 * 1000) {
    receipts.delete(receiptId);
    return null;
  }
  receipt.consumed = true;
  receipts.delete(receiptId);
  return receipt;
}

/**
 * Pipeline enforcement: require a valid sanitization receipt before any image upload.
 * Throws if the receipt is missing, invalid, expired, or already used.
 */
export function requireImageSanitization(receiptId: string | undefined): SanitizationReceipt {
  if (!receiptId) {
    throw new Error(
      "Image upload blocked: no sanitization receipt. All images must be reviewed in the privacy gate before transmission.",
    );
  }
  const receipt = consumeReceipt(receiptId);
  if (!receipt) {
    throw new Error(
      "Image upload blocked: sanitization receipt is invalid, expired, or already used. Review the image again.",
    );
  }
  if (receipt.decision === "withheld") {
    throw new Error(
      "Image upload blocked: this image was withheld by the privacy gate.",
    );
  }
  return receipt;
}

/** Build the metadata payload that accompanies a sanitised image upload to the backend. */
export function sanitizationMetadata(receipt: SanitizationReceipt): {
  sanitizationStatus: string;
  sanitizationDecision: string;
  sanitizationDigest: string;
  sensitiveRegionsFound: number;
  redactedRegions: number;
  sanitizationPurpose: string;
  sanitizationTransformations: string[];
  sanitizationLimitations: string[];
} {
  return {
    sanitizationStatus: "approved",
    sanitizationDecision: receipt.decision,
    sanitizationDigest: receipt.imageDigest,
    sensitiveRegionsFound: receipt.sensitiveRegionsFound,
    redactedRegions: receipt.redactedRegions,
    sanitizationPurpose: receipt.purpose,
    sanitizationTransformations: receipt.transformations,
    sanitizationLimitations: receipt.limitations,
  };
}
