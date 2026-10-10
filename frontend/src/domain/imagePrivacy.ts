/**
 * On-device Image Privacy Screening
 *
 * Performs sensitive-information detection and redaction LOCALLY before any image
 * is transmitted to Gemini or any external service. Cloud Gemini is never used as
 * the initial privacy-screening mechanism.
 *
 * Architecture:
 * 1. Strip EXIF/metadata by re-encoding through expo-image-manipulator
 * 2. Extract text locally using on-device OCR (ML Kit / Apple Vision via expo-ocr-kit)
 * 3. Detect credentials, PII, and sensitive content in extracted text (imagePrivacyCore.ts)
 * 4. For text-sufficient cases: send redacted text only, image never leaves device
 * 5. For visual-evidence cases: redact detected regions, require user approval
 * 6. If local screening fails: withhold image, offer manual crop or text-only
 *
 * Every image-to-Gemini pathway MUST pass through screenImage() first.
 * No unscreened image may be transmitted externally.
 */
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";

// Re-export pure functions from core for convenience
export {
  detectSensitiveContent,
  redactText,
  redactAllSensitive,
  classifyRegions,
  hasVisuallySignificantContent,
} from "./imagePrivacyCore.ts";

import type { TextRegion } from "./imagePrivacyCore.ts";
import { detectSensitiveContent, redactAllSensitive, redactText, classifyRegions, hasVisuallySignificantContent } from "./imagePrivacyCore.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScreeningResult {
  /** Whether screening succeeded or the image should be withheld. */
  status: "screened" | "withheld" | "text_only" | "ocr_unavailable";
  /** Extracted text from the image (credential-redacted). */
  extractedText: string;
  /** Raw extracted text before redaction (kept in memory only, never transmitted). */
  rawTextLocal: string;
  /** Regions containing sensitive content. */
  sensitiveRegions: TextRegion[];
  /** All detected text regions with bounding boxes. */
  allRegions: TextRegion[];
  /** URI of the sanitised image (metadata stripped, sensitive regions redacted). Null if text_only or withheld. */
  sanitisedImageUri: string | null;
  /** URI of the metadata-stripped image before redaction (for preview comparison). */
  strippedImageUri: string | null;
  /** Whether the original image contains sensitive content that was redacted. */
  hasRedactions: boolean;
  /** Human-readable summary of what was detected and redacted. */
  screeningSummary: string;
  /** Whether this image is suitable for text-only submission (no visual layout needed). */
  textOnlySuitable: boolean;
  /** The original image dimensions. */
  dimensions: { width: number; height: number } | null;
}

export type SubmissionChoice =
  | { type: "text_only"; redactedText: string }
  | { type: "sanitised_image"; imageUri: string; redactedText: string }
  | { type: "withheld" }
  | { type: "manual_crop"; croppedImageUri: string };

// ── Image Processing (native-dependent) ──────────────────────────────────────

/** Strip EXIF metadata by re-encoding the image. Returns URI of the clean image.
 *  Re-encoding through expo-image-manipulator permanently removes EXIF, GPS, camera
 *  data, and thumbnails. The output is a fresh JPEG with only pixel data. */
export async function stripMetadata(imageUri: string): Promise<{ uri: string; width: number; height: number }> {
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [], // No transformations — just re-encode to strip metadata
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Attempt on-device OCR. Returns null if the native module is unavailable.
 *  Uses ML Kit (Android) / Apple Vision (iOS) via expo-ocr-kit. */
export async function extractTextLocally(imageUri: string): Promise<TextRegion[] | null> {
  try {
    // Dynamic import: expo-ocr-kit requires a native build.
    // In Expo Go or web, this will fail and we return null (OCR unavailable).
    const OcrKit = require("expo-ocr-kit");
    const result = await OcrKit.recognizeText(imageUri);
    if (!result || !result.blocks) return null;
    return classifyRegions(result.blocks);
  } catch {
    return null; // OCR native module not available
  }
}

/** Create a redacted version of the image by cropping out sensitive regions.
 *  Since expo-image-manipulator doesn't support pixel-level drawing, we crop to
 *  exclude sensitive areas. For dense multi-region redaction, text-only is preferred. */
export async function redactImageRegions(
  imageUri: string,
  regions: TextRegion[],
  dimensions: { width: number; height: number },
): Promise<string | null> {
  const sensitive = regions.filter((r) => r.isSensitive);
  if (sensitive.length === 0) return imageUri;

  const safeTop = Math.min(...sensitive.map((r) => r.frame.y));
  const safeBottom = Math.max(...sensitive.map((r) => r.frame.y + r.frame.height));
  const sensitiveSpan = safeBottom - safeTop;

  // If sensitive content spans most of the image, cropping can't salvage it safely.
  if (sensitiveSpan > dimensions.height * 0.7) return null;

  // Crop to the larger safe region (above or below the sensitive content).
  const topSafe = safeTop;
  const bottomSafe = dimensions.height - safeBottom;

  try {
    if (topSafe >= bottomSafe && topSafe > 40) {
      const result = await ImageManipulator.manipulateAsync(imageUri,
        [{ crop: { originX: 0, originY: 0, width: dimensions.width, height: safeTop } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
      return result.uri;
    }
    if (bottomSafe > 40) {
      const result = await ImageManipulator.manipulateAsync(imageUri,
        [{ crop: { originX: 0, originY: safeBottom, width: dimensions.width, height: bottomSafe } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
      return result.uri;
    }
  } catch {
    // Crop failed
  }
  return null; // Cannot crop safely — recommend text-only or manual crop
}

// ── Main Screening Pipeline ──────────────────────────────────────────────────

/** Screen an image for sensitive content before any external transmission.
 *
 *  This MUST be called before any image is sent to Gemini, the backend, or any
 *  external service. No unscreened image may bypass this function.
 *
 *  @param imageUri Local file URI of the image to screen
 *  @param purpose "message_screenshot" | "investigation_evidence"
 */
export async function screenImage(
  imageUri: string,
  purpose: "message_screenshot" | "investigation_evidence" = "investigation_evidence",
): Promise<ScreeningResult> {
  // Step 1: Strip metadata (always, regardless of content)
  let stripped: { uri: string; width: number; height: number };
  try {
    stripped = await stripMetadata(imageUri);
  } catch {
    return {
      status: "withheld", extractedText: "", rawTextLocal: "",
      sensitiveRegions: [], allRegions: [],
      sanitisedImageUri: null, strippedImageUri: null,
      hasRedactions: false,
      screeningSummary: "Could not process this image safely. The image has been withheld.",
      textOnlySuitable: false, dimensions: null,
    };
  }

  // Step 2: Attempt on-device OCR
  const regions = await extractTextLocally(stripped.uri);

  if (regions === null) {
    return {
      status: "ocr_unavailable", extractedText: "", rawTextLocal: "",
      sensitiveRegions: [], allRegions: [],
      sanitisedImageUri: null, strippedImageUri: stripped.uri,
      hasRedactions: false,
      screeningSummary: "On-device text recognition is not available. The image cannot be screened locally. You can type the text manually or use a native build for automatic screening.",
      textOnlySuitable: true,
      dimensions: { width: stripped.width, height: stripped.height },
    };
  }

  // Step 3: Combine text and detect sensitive content
  const allText = regions.map((r) => r.text).join("\n");
  const sensitiveRegions = regions.filter((r) => r.isSensitive);
  const hasCredentials = sensitiveRegions.some((r) => r.sensitiveType === "credential");
  const hasPII = sensitiveRegions.some((r) => r.sensitiveType === "pii" || r.sensitiveType === "financial" || r.sensitiveType === "medical");

  // Step 4: Redact text
  const redactedText = hasCredentials ? redactAllSensitive(allText) : (hasPII ? redactText(allText) : allText);

  // Step 5: Message screenshots → text-only (image never leaves device)
  if (purpose === "message_screenshot") {
    const summaryParts: string[] = [];
    if (hasCredentials) summaryParts.push("credentials detected and redacted");
    if (hasPII) summaryParts.push("personal information detected");
    if (summaryParts.length === 0) summaryParts.push("no sensitive content detected");

    return {
      status: "text_only", extractedText: redactedText, rawTextLocal: allText,
      sensitiveRegions, allRegions: regions,
      sanitisedImageUri: null, strippedImageUri: stripped.uri,
      hasRedactions: hasCredentials || hasPII,
      screeningSummary: `Text extracted locally. ${summaryParts.join("; ")}. Only the redacted text will be sent — the image stays on your device.`,
      textOnlySuitable: true,
      dimensions: { width: stripped.width, height: stripped.height },
    };
  }

  // Step 6: Investigation evidence — redact image if needed
  let sanitisedUri: string | null = stripped.uri;
  if (sensitiveRegions.length > 0) {
    sanitisedUri = await redactImageRegions(stripped.uri, regions, { width: stripped.width, height: stripped.height });
  }

  const summaryParts: string[] = [];
  if (hasCredentials) summaryParts.push("credentials detected and removed");
  if (hasPII) summaryParts.push("personal information detected — review the preview");
  if (summaryParts.length === 0) summaryParts.push("no sensitive content detected");

  const textOnly = !hasVisuallySignificantContent(regions);

  return {
    status: sanitisedUri ? "screened" : "withheld",
    extractedText: redactedText, rawTextLocal: allText,
    sensitiveRegions, allRegions: regions,
    sanitisedImageUri: sanitisedUri, strippedImageUri: stripped.uri,
    hasRedactions: sensitiveRegions.length > 0,
    screeningSummary: `${summaryParts.join("; ")}. Metadata stripped. ${sanitisedUri ? "Review the sanitised image before sending." : "The image has been withheld. You can send the extracted text or crop manually."}`,
    textOnlySuitable: textOnly,
    dimensions: { width: stripped.width, height: stripped.height },
  };
}

/** Cleanup temporary screening files. Call after the submission decision is made. */
export async function cleanupScreeningFiles(result: ScreeningResult): Promise<void> {
  const uris = [result.sanitisedImageUri, result.strippedImageUri].filter(Boolean) as string[];
  for (const uri of uris) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch { /* best-effort cleanup */ }
  }
}
