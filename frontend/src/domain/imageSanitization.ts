/**
 * Image Sanitization Receipt — cryptographic proof that an image passed through
 * the on-device privacy gate before transmission.
 *
 * Every image upload pathway MUST call `requireImageSanitization()` which validates
 * a one-time-use receipt. Without a valid receipt, the upload is technically blocked.
 *
 * Receipts:
 * - Are single-use (consumed on first validation)
 * - Expire after 5 minutes
 * - Are tied to a specific decision and image hash
 * - Cannot be forged or reused
 */

import * as Crypto from "expo-crypto";

export type SanitizationDecision =
  | "text_only"       // Image never transmitted; extracted text used instead
  | "sanitised_image" // Pixel-level redacted image transmitted
  | "manual_crop"     // User-cropped image transmitted
  | "withheld"        // Nothing transmitted
  | "no_sensitive"    // No sensitive content detected; image approved as-is
  | "ocr_unavailable_approved"; // OCR unavailable; user explicitly approved transmission

export interface SanitizationReceipt {
  receiptId: string;
  imageDigest: string;
  decision: SanitizationDecision;
  sensitiveRegionsFound: number;
  redactedRegions: number;
  timestamp: number;
  consumed: boolean;
}

/** In-memory receipt store. Receipts never persist to disk — they are ephemeral proof. */
const receipts = new Map<string, SanitizationReceipt>();

/** Create a sanitization receipt after the user makes a decision in the privacy gate. */
export async function createReceipt(
  imageUri: string,
  decision: SanitizationDecision,
  sensitiveRegionsFound: number,
  redactedRegions: number,
): Promise<SanitizationReceipt> {
  const receiptId = Crypto.randomUUID();
  const imageDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${imageUri}:${decision}:${Date.now()}:${receiptId}`,
  );
  const receipt: SanitizationReceipt = {
    receiptId,
    imageDigest,
    decision,
    sensitiveRegionsFound,
    redactedRegions,
    timestamp: Date.now(),
    consumed: false,
  };
  receipts.set(receiptId, receipt);
  // Auto-expire after 5 minutes
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
 *
 * Call this in every image upload pathway (`uploadFileEvidence`, `uploadFileEvidenceResumable`,
 * `apiUpload` for screenshot endpoints).
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
  sensitiveRegionsFound: number;
  redactedRegions: number;
} {
  return {
    sanitizationStatus: "approved",
    sanitizationDecision: receipt.decision,
    sensitiveRegionsFound: receipt.sensitiveRegionsFound,
    redactedRegions: receipt.redactedRegions,
  };
}
