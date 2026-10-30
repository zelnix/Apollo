/**
 * The ONE module the application may import for anything simulated.
 *
 * Everything under src/simulation/ is preview-only source. Application code never reaches into this
 * folder directly — it imports `@/src/simulation`, and which file that specifier resolves to is a
 * BUILD decision made in babel.config.js:
 *
 *   preview build (EXPO_PUBLIC_PREVIEW_BUILD=included) → this file, and the whole folder with it
 *   production build                                   → src/simulationAbsent.ts, a data-free stub
 *
 * So a production artifact contains no simulation code, no fixtures and no sample identifiers —
 * not a disabled copy of them. Nothing here is a fallback for a real capability: when the real
 * source of an input cannot be reached, the screen says so; the samples only offer an input the
 * person can choose, which then goes through Apollo's ordinary, real check.
 */
import { registerSimulatedRead } from "@/src/domain/imagePrivacy";
import type { PreviewSimulation } from "@/src/simulationContract";

import { SimulatedPicker } from "./SimulatedPicker";
import { SIMULATED_EMAILS } from "./simulatedInbox";
import {
  SIMULATED_APPS, SIMULATED_CALLS, SIMULATED_DEVICE_CONCERNS, SIMULATED_FILES,
  SIMULATED_LINKS, SIMULATED_SCREENSHOTS, SIMULATED_TEXTS,
} from "./simulatedItems";
import { registerPreviewImage, simulatedRead } from "./simulatedScreening";

export type {
  PickerProps, PreviewSimulation, SimulatedApp, SimulatedCall, SimulatedChoice,
  SimulatedDeviceConcern, SimulatedEmail, SimulatedFile, SimulatedImageRead,
  SimulatedLink, SimulatedScreenshot, SimulatedText,
} from "@/src/simulationContract";

export const simulation: PreviewSimulation = {
  included: true,
  tag: "PREVIEW ONLY",
  accountLabel: "Simulated inbox (preview)",
  texts: SIMULATED_TEXTS,
  calls: SIMULATED_CALLS,
  apps: SIMULATED_APPS,
  files: SIMULATED_FILES,
  links: SIMULATED_LINKS,
  deviceConcerns: SIMULATED_DEVICE_CONCERNS,
  screenshots: SIMULATED_SCREENSHOTS,
  emails: SIMULATED_EMAILS,
  Picker: SimulatedPicker,
  registerImage: registerPreviewImage,
  read: simulatedRead,
  // The hand-written example case an earlier preview seeded never went through Apollo's checks.
  retiredEventIds: ["preview-mock-threat-001"],
};

// The image screening path never imports this folder — it accepts a registration instead, so a
// production build has no reference to simulation at all and simply reports that no text was read.
registerSimulatedRead(simulatedRead);
