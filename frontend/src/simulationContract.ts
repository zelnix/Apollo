/**
 * The shape of the one simulation surface the application may use.
 *
 * Types only — nothing here exists at runtime, so this file has no footprint in either artifact. Both
 * `src/simulation/index.ts` (preview build) and `src/simulationAbsent.ts` (production build) are
 * declared as this type, so the compiler itself guarantees there is no configuration in which only
 * part of the simulation system is present: every member is on both sides or neither.
 */
import type { PatrolEvent } from "@/src/domain/types";
import type { SimulatedChoice } from "@/src/simulation/SimulatedPicker";
import type { SimulatedEmail } from "@/src/simulation/simulatedInbox";
import type {
  SimulatedApp, SimulatedCall, SimulatedDeviceConcern, SimulatedFile,
  SimulatedLink, SimulatedScreenshot, SimulatedText,
} from "@/src/simulation/simulatedItems";

export type {
  SimulatedApp, SimulatedCall, SimulatedChoice, SimulatedDeviceConcern, SimulatedEmail,
  SimulatedFile, SimulatedLink, SimulatedScreenshot, SimulatedText,
};

/** What a simulated on-device text read returns, in the shape the native recogniser uses. */
export interface SimulatedImageRead {
  blocks: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>;
  fromSample: boolean;
  notice: string;
}

export interface PickerProps {
  title: string;
  note: string;
  items: SimulatedChoice[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  testID: string;
  selectedId?: string | null;
}

export interface PreviewSimulation {
  /** True only in a preview build, where this whole folder is part of the bundle. */
  included: boolean;
  /** The marking shown on anything simulated. Empty in a production build, so no label ships. */
  tag: string;
  /** How a check run from a sample is recorded. Empty in a production build. */
  accountLabel: string;
  texts: SimulatedText[];
  calls: SimulatedCall[];
  apps: SimulatedApp[];
  files: SimulatedFile[];
  links: SimulatedLink[];
  deviceConcerns: SimulatedDeviceConcern[];
  screenshots: SimulatedScreenshot[];
  emails: SimulatedEmail[];
  /** The sample picker. Renders nothing in a production build. */
  Picker: (props: PickerProps) => React.ReactElement | null;
  /** Remembers a sample image so its declared text can be replayed by the screening path. */
  registerImage: (uri: string, sampleId: string) => void;
  /** The simulated text read. Always null in a production build. */
  read: (uri: string) => SimulatedImageRead | null;
  /** The clearly-labelled example threat case. Null in a production build. */
  exampleCase: PatrolEvent | null;
}
