// Number Details on a call's top card: the number's country, line type and original network. The server reads them
// from the numbering-plan data built into libphonenumber — no lookup service, no account. Pure: no React, no I/O.
import type { OriginalSource } from "../store/originalSource";
import type { PatrolEvent } from "./types";

export interface NumberDetailsData {
  number: string;
  /** False: the number matches no range in use. */
  valid: boolean;
  country_code: string | null;
  country: string | null;
  line_type: string | null;
  /** The network the number's range was first given to (mobile numbers only). */
  network: string | null;
}

export interface NumberDetailItem { id: "country" | "line_type" | "network"; label: string; value: string }

const NUMBER_FIELD = /^(number|caller|from|phone)$/i;

/** The phone number a call case is about: the kept original's Number, else what the case recorded. Null when the case
 *  isn't a call, or no number was recorded. */
export function callNumberOf(original: OriginalSource | null | undefined, event: PatrolEvent | null | undefined): string | null {
  const isCall = original?.kind === "call" || event?.category === "call" || event?.source_metadata?.type === "call";
  if (!isCall) return null;
  const raw = original?.fields?.find((f) => NUMBER_FIELD.test(f.label.trim()))?.value
    ?? event?.source_metadata?.sender ?? event?.local_indicator ?? null;
  const value = raw?.trim() ?? "";
  return value.replace(/\D/g, "").length >= 6 ? value : null;
}

/** The three rows, in plain words. A value the data doesn't give says so — never a guess. */
export function numberDetailItems(d: NumberDetailsData): NumberDetailItem[] {
  return [
    { id: "country", label: "Country", value: d.country ?? d.country_code ?? "Not known" },
    { id: "line_type", label: "Line type", value: d.valid ? d.line_type ?? "Not known" : "Not a number in use" },
    { id: "network", label: "Original network", value: d.network ?? (d.valid ? "Not given for this number" : "None") },
  ];
}

/** Said under the rows when a network is named: numbers can move. */
export const NETWORK_NOTE = "The network the number started on. Numbers can move to another network.";
