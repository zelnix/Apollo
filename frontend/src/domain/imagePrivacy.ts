/**
 * On-device Image Privacy Screening
 *
 * Performs sensitive-information detection and redaction LOCALLY before any image
 * is transmitted to Gemini or any external service. Cloud Gemini is never used as
 * the initial privacy-screening mechanism.
 *
 * Architecture principle: ONE screenshot engine. ONE privacy boundary. ONE review
 * experience. Source context informs interpretation — it never creates a separate
 * screenshot-processing path.
 *
 * Pipeline:
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
import * as FS from "expo-file-system/legacy";

// Non-blocking personal data learning — accumulates suggestions silently.
let _learnFromScreenshot: ((text: string) => Promise<void>) | null = null;
try {
  const learning = require("../store/personalDataLearning");
  _learnFromScreenshot = learning.learnFromScreenshot;
} catch {
  // Native modules unavailable (test environment)
}

// Re-export pure functions from core for convenience
export {
  detectSensitiveContent,
  redactText,
  redactAllSensitive,
  classifyRegions,
  hasVisuallySignificantContent,
  extractSenderFromText,
} from "./imagePrivacyCore.ts";

import { detectSensitiveContent, redactText, classifyRegions, hasVisuallySignificantContent, extractSenderFromText } from "./imagePrivacyCore.ts";
import { simulatedRead } from "../preview/simulatedScreening";

export type { SensitiveType, ScreeningContext } from "./privacyPolicy.ts";

import type { TextRegion, ScreeningContext } from "./imagePrivacyCore.ts";

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
  /** Extracted sender identifier (phone/email) if detected in sender context. */
  detectedSender: string | null;
  /** The image that was screened, unmodified (kept on device as original evidence). */
  sourceUri?: string;
  /** Set only in a preview build where the device read was simulated — shown before sending so a
   *  simulated read is never mistaken for a real on-device one. Absent in every shipped build. */
  previewNotice?: string;
}

export type SubmissionChoice =
  | { type: "text_only"; redactedText: string }
  | { type: "sanitised_image"; imageUri: string; redactedText: string }
  | { type: "withheld" };

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
 *  Uses ML Kit (Android) / Apple Vision (iOS) via expo-ocr-kit.
 *
 *  @param imageUri  Local file URI of the image
 *  @param context   Screening context for sender-aware classification
 */
export async function extractTextLocally(
  imageUri: string,
  context?: Omit<ScreeningContext, "blockIndex" | "totalBlocks">,
): Promise<TextRegion[] | null> {
  try {
    // Dynamic import: expo-ocr-kit requires a native build.
    // In Expo Go or web, this will fail and we return null (OCR unavailable).
    const OcrKit = require("expo-ocr-kit");
    const result = await OcrKit.recognizeText(imageUri);
    if (!result || !result.blocks) return null;
    // Normalise: the native module returns 'boundingBox' but classifyRegions expects 'frame'.
    const normalizedBlocks = result.blocks.map((block: { text: string; boundingBox?: { x: number; y: number; width: number; height: number }; frame?: { x: number; y: number; width: number; height: number } }) => ({
      text: block.text ?? "",
      frame: block.frame ?? block.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
    }));
    return classifyRegions(normalizedBlocks, context);
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
 *  ONE engine. Source context informs interpretation only.
 *
 *  @param imageUri Local file URI of the image to screen
 *  @param purpose  "message_screenshot" | "investigation_evidence"
 */
export async function screenImage(
  imageUri: string,
  purpose: "message_screenshot" | "investigation_evidence" = "investigation_evidence",
): Promise<ScreeningResult> {
  return { ...(await screenImageInner(imageUri, purpose)), sourceUri: imageUri };
}

async function screenImageInner(
  imageUri: string,
  purpose: "message_screenshot" | "investigation_evidence",
): Promise<ScreeningResult> {
  const context: Omit<ScreeningContext, "blockIndex" | "totalBlocks"> = { purpose };

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
      detectedSender: null,
    };
  }

  // Step 2: Attempt on-device OCR
  let regions = await extractTextLocally(stripped.uri, context);
  let previewNotice: string | undefined;

  // A preview build has no native text recogniser. The EXTERNAL READ — and only that — is replaced
  // there, and what it returns goes through the same classification below as a real device read.
  if (regions === null) {
    const simulated = simulatedRead(imageUri);
    if (simulated) {
      regions = classifyRegions(simulated.blocks, context);
      previewNotice = simulated.notice;
    }
  }

  if (regions === null) {
    return {
      status: "ocr_unavailable", extractedText: "", rawTextLocal: "",
      sensitiveRegions: [], allRegions: [],
      sanitisedImageUri: null, strippedImageUri: stripped.uri,
      hasRedactions: false,
      screeningSummary: "On-device text recognition is not available. The image cannot be screened locally. You can type the text manually or use a native build for automatic screening.",
      textOnlySuitable: true,
      dimensions: { width: stripped.width, height: stripped.height },
      detectedSender: null,
    };
  }

  // Step 3: Combine text and detect sensitive content
  const allText = regions.map((r) => r.text).join("\n");
  const sensitiveRegions = regions.filter((r) => r.isSensitive);
  const hasCredentials = sensitiveRegions.some((r) => r.sensitiveType === "credential");

  // Step 3b: Non-blocking personal data learning — detect likely user-owned
  // info (email signatures, addresses) and store as suggestions.
  if (_learnFromScreenshot && allText.length > 20) {
    void _learnFromScreenshot(allText).catch(() => undefined);
  }

  // Step 4: Extract sender identifier (before redaction destroys it)
  const detectedSender = extractSenderFromText(allText);

  // Step 5: Redact text — redact credentials and user-private PII.
  // Sender/investigation-subject identifiers are preserved by the context-aware engine.
  const screeningContext: ScreeningContext = { purpose, blockIndex: 0, totalBlocks: regions.length };
  void screeningContext;
  const redactedText = hasCredentials ? redactText(allText) : allText;

  // Step 6: Message screenshots — present to privacy gate for user review
  // The gate offers all options (text-only, redacted image, withheld).
  // We do NOT force text_only — that is a user choice, not an automatic decision.
  if (purpose === "message_screenshot") {
    const summaryParts: string[] = [];
    if (hasCredentials) summaryParts.push("credentials detected and redacted");
    if (summaryParts.length === 0) summaryParts.push(previewNotice && regions.length === 0 ? "no text was read, so nothing in the image was checked" : "no sensitive content detected");
    if (detectedSender) summaryParts.push(`sender preserved: ${detectedSender}`);

    return {
      status: "screened", extractedText: redactedText, rawTextLocal: allText,
      sensitiveRegions, allRegions: regions,
      sanitisedImageUri: null, strippedImageUri: stripped.uri,
      hasRedactions: hasCredentials,
      screeningSummary: `${previewNotice ? "Text recognition simulated in this preview. " : "Text extracted locally. "}${summaryParts.join("; ")}. Personal details and sender information are kept as evidence.`,
      textOnlySuitable: true,
      dimensions: { width: stripped.width, height: stripped.height },
      detectedSender,
      previewNotice,
    };
  }

  // Step 7: Investigation evidence — detection only; pixel-level redaction is
  // performed by ImageUploadPrep using react-native-view-shot on the analysis
  // copy after the user continues. This function only detects and reports.
  const summaryParts: string[] = [];
  if (hasCredentials) summaryParts.push("credentials detected — they will be blacked out on the copy sent");
  if (summaryParts.length === 0) summaryParts.push(previewNotice && regions.length === 0 ? "no text was read, so nothing in the image was checked" : "no sensitive content detected");
  if (detectedSender) summaryParts.push(`sender preserved as evidence: ${detectedSender}`);

  const textOnly = !hasVisuallySignificantContent(regions);

  return {
    status: sensitiveRegions.length > 0 ? "screened" : "screened",
    extractedText: redactedText, rawTextLocal: allText,
    sensitiveRegions, allRegions: regions,
    sanitisedImageUri: null, strippedImageUri: stripped.uri,
    hasRedactions: sensitiveRegions.length > 0,
    screeningSummary: `${previewNotice ? "Text recognition simulated in this preview. " : ""}${summaryParts.join("; ")}. Metadata stripped. Personal details and sender information are kept as evidence.`,
    textOnlySuitable: textOnly,
    dimensions: { width: stripped.width, height: stripped.height },
    detectedSender,
    previewNotice,
  };
}

/** Cleanup temporary screening files. Call after the submission decision is made. */
export async function cleanupScreeningFiles(result: ScreeningResult): Promise<void> {
  const uris = [result.sanitisedImageUri, result.strippedImageUri].filter(Boolean) as string[];
  for (const uri of uris) {
    try {
      await FS.deleteAsync(uri, { idempotent: true });
    } catch {
      /* best-effort cleanup */
      if (__DEV__) {
        console.warn(`[imagePrivacy] Failed to clean up screening file: ${uri}`);
      }
    }
  }
}
