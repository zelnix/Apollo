// The ONLY way preview sample data enters the app.
//
// Preview samples exist so the real checks can be exercised where the preview cannot reach a real
// source (no SMS list, no call log, no installed-app list, no mailbox). They must never reach a
// person using the shipped app, so this module is the single gate:
//
//   - The preview IS the Metro dev server, and every shipped build (native store build or exported
//     web build) is a production bundle where `__DEV__` is a compile-time `false`. Gating on it
//     therefore removes the samples from every shipped build automatically — nothing to remember at
//     deploy time, and no env var can switch them back on.
//     (Security enforcement still NEVER derives its environment from `__DEV__` — see securityConfig.)
//   - `EXPO_PUBLIC_PREVIEW_SAMPLES=off` is an extra kill switch for turning samples off in the
//     preview itself.
//   - When disabled every collection is empty, so a screen that forgot its own gate still has
//     nothing to show and nothing to feed into a check.

import type {
  SimulatedApp, SimulatedCall, SimulatedDeviceConcern, SimulatedFile,
  SimulatedLink, SimulatedScreenshot, SimulatedText,
} from "./simulatedItems";
import type { SimulatedEmail } from "./simulatedInbox";

export type {
  SimulatedApp, SimulatedCall, SimulatedDeviceConcern, SimulatedFile,
  SimulatedLink, SimulatedScreenshot, SimulatedText,
} from "./simulatedItems";
export type { SimulatedEmail } from "./simulatedInbox";

/** False in every shipped build. */
export const PREVIEW_SAMPLES_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_PREVIEW_SAMPLES !== "off";

interface PreviewSamples {
  SIMULATED_TEXTS: SimulatedText[];
  SIMULATED_CALLS: SimulatedCall[];
  SIMULATED_APPS: SimulatedApp[];
  SIMULATED_FILES: SimulatedFile[];
  SIMULATED_LINKS: SimulatedLink[];
  SIMULATED_DEVICE_CONCERNS: SimulatedDeviceConcern[];
  SIMULATED_SCREENSHOTS: SimulatedScreenshot[];
  SIMULATED_EMAILS: SimulatedEmail[];
}

const EMPTY: PreviewSamples = {
  SIMULATED_TEXTS: [], SIMULATED_CALLS: [], SIMULATED_APPS: [], SIMULATED_FILES: [],
  SIMULATED_LINKS: [], SIMULATED_DEVICE_CONCERNS: [], SIMULATED_SCREENSHOTS: [], SIMULATED_EMAILS: [],
};

function load(): PreviewSamples {
  if (!PREVIEW_SAMPLES_ENABLED) return EMPTY;
  const items = require("./simulatedItems") as Omit<PreviewSamples, "SIMULATED_EMAILS">;
  const inbox = require("./simulatedInbox") as Pick<PreviewSamples, "SIMULATED_EMAILS">;
  return { ...items, SIMULATED_EMAILS: inbox.SIMULATED_EMAILS };
}

export const PREVIEW_SAMPLES: PreviewSamples = load();

export const {
  SIMULATED_TEXTS, SIMULATED_CALLS, SIMULATED_APPS, SIMULATED_FILES,
  SIMULATED_LINKS, SIMULATED_DEVICE_CONCERNS, SIMULATED_SCREENSHOTS, SIMULATED_EMAILS,
} = PREVIEW_SAMPLES;
