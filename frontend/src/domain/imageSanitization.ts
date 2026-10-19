/**
 * Image privacy result — what the on-device privacy step did to an image before it was sent.
 *
 * Rule: protect credentials, preserve evidence, let Apollo investigate.
 * - Submitting an image is the authorisation to analyse it.
 * - Only detected credentials/authentication secrets are redacted (pixel-level, on a copy).
 * - Names, numbers, emails, accounts, payment details, senders, URLs and layout stay intact as evidence.
 * - If a detected credential can't be redacted, that image is not sent (fail closed).
 * - The original file is never modified.
 */

export type SanitizationDecision =
  | "text_only"          // Image not sent; extracted text used instead
  | "sanitised_image"    // Copy with detected credentials blacked out
  | "withheld"           // Nothing sent
  | "approved_image"     // No credentials detected; metadata-stripped copy sent
  | "visual_review_only" // On-device text recognition unavailable; metadata-stripped copy sent
  | "no_sensitive";      // @deprecated alias of approved_image

export interface SanitizationReceipt {
  decision: SanitizationDecision;
  redactedRegions: number;
  /** Plain description of what was done to the copy (recorded with the evidence). */
  transformations: string[];
}

export async function createReceipt(
  _imageUri: string | null,
  decision: SanitizationDecision,
  _sensitiveRegionsFound: number,
  redactedRegions: number,
  options?: { transformations?: string[] },
): Promise<SanitizationReceipt | null> {
  return { decision, redactedRegions, transformations: options?.transformations ?? [] };
}

/** Informational metadata recorded with an uploaded investigation image. */
export function sanitizationMetadata(receipt: SanitizationReceipt): {
  sanitizationDecision: string; redactedRegions: number; sanitizationTransformations: string[];
} {
  return { sanitizationDecision: receipt.decision, redactedRegions: receipt.redactedRegions, sanitizationTransformations: receipt.transformations };
}
