// Preview-only stand-in for on-device text recognition — the native boundary, and nothing else.
//
// Apollo screens every image on the device before it is sent: it reads the text with ML Kit /
// Apple Vision (expo-ocr-kit), finds credentials, blacks them out on the copy it sends, and
// refuses to send anything it cannot verify. No web preview can run that native module, so the
// whole image path dead-ended at "Image not sent" — including Apollo's own sample screenshots.
//
// This module replaces the EXTERNAL READ ONLY. What it hands back then goes through the real
// detection, the real redaction and the real fail-closed rules, untouched:
//   - a preview sample screenshot → the text those pixels actually show, with its real box
//     (generated from the same code that drew them — see simulatedScreenshotText.ts);
//   - any other image → NO text, because nothing read it. Apollo is told plainly that it did not
//     read the image, and the popup says so, so a screened-looking result can never be claimed
//     for a picture nobody looked at.
//
// Gated on PREVIEW_SAMPLES_ENABLED, so in every shipped build this returns null and the image
// path stays fail-closed exactly as before.
import { PREVIEW_SAMPLES_ENABLED } from "./samples";
import type { SimulatedTextBlock } from "./simulatedScreenshotText";

export interface SimulatedRead {
  /** Text blocks in the shape the native recogniser returns. A null frame becomes a zero-size
   *  box: read, but not locatable — Apollo cannot black that out and will not send the image. */
  blocks: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>;
  /** True when these blocks are the declared contents of a preview sample image. */
  fromSample: boolean;
  /** Plain-English notice shown before the image is sent. Never implies a real on-device read. */
  notice: string;
}

const SAMPLE_NOTICE =
  "This preview cannot run on-device text recognition. Apollo screened the text this sample image "
  + "is known to contain; nothing was read from the picture itself. On a phone build the image is "
  + "read on your device.";

const UNREAD_NOTICE =
  "This preview cannot run on-device text recognition, so no text was read from this image. "
  + "Nothing in it has been checked for passwords, PINs or codes. On a phone build Apollo reads the "
  + "image on your device and blacks out any it finds before sending.";

/** Local file URIs of preview sample screenshots, keyed to the sample they came from. */
const registered = new Map<string, string>();

/** Remember that this URI is a preview sample image, so its declared text can be replayed. */
export function registerPreviewImage(uri: string, sampleId: string): void {
  if (!PREVIEW_SAMPLES_ENABLED) return;
  registered.set(uri, sampleId);
}

function declaredBlocks(sampleId: string): SimulatedTextBlock[] | null {
  const data = require("./simulatedScreenshotText") as {
    SIMULATED_SCREENSHOT_TEXT: Record<string, SimulatedTextBlock[]>;
  };
  return data.SIMULATED_SCREENSHOT_TEXT[sampleId] ?? null;
}

/** The simulated read. Null in every shipped build, and whenever samples are switched off. */
export function simulatedRead(uri: string): SimulatedRead | null {
  if (!PREVIEW_SAMPLES_ENABLED) return null;
  const sampleId = registered.get(uri);
  const blocks = sampleId ? declaredBlocks(sampleId) : null;
  if (!blocks) return { blocks: [], fromSample: false, notice: UNREAD_NOTICE };
  return {
    blocks: blocks.map((b) => ({ text: b.text, frame: b.frame ?? { x: 0, y: 0, width: 0, height: 0 } })),
    fromSample: true,
    notice: SAMPLE_NOTICE,
  };
}
