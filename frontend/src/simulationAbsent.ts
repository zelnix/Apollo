/**
 * Production stand-in for `@/src/simulation` — contains NO simulation code, data or identifiers.
 *
 * In a production build `babel.config.js` rewrites every `@/src/simulation` import to this file, so
 * src/simulation/ is never resolved by Metro and none of it reaches the artifact. Both sides are
 * declared as the same `PreviewSimulation` type, so there is no configuration in which only part of
 * the simulation system is present: either all of it is bundled (preview build) or none of it is.
 *
 * Nothing here is a fallback. Every value says "there is no simulation", which leaves the real code
 * reporting its genuine unavailable / cannot-verify / error state. The labels are empty strings, so
 * even the preview markings do not ship.
 */
import type { PreviewSimulation } from "@/src/simulationContract";

export type {
  PickerProps, PreviewSimulation, SimulatedApp, SimulatedCall, SimulatedChoice,
  SimulatedDeviceConcern, SimulatedEmail, SimulatedFile, SimulatedImageRead,
  SimulatedLink, SimulatedScreenshot, SimulatedText,
} from "@/src/simulationContract";

export const simulation: PreviewSimulation = {
  included: false,
  tag: "",
  accountLabel: "",
  texts: [],
  calls: [],
  apps: [],
  files: [],
  links: [],
  deviceConcerns: [],
  screenshots: [],
  emails: [],
  Picker: () => null,
  registerImage: () => {},
  read: () => null,
};
