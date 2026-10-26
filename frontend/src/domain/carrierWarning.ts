// A scam warning the person's mobile carrier showed on a call (Telstra Scam Protect's "Warning: Potential Fraud").
// ApolloSG never sees the label itself — the person tells it — so it is always recorded as their report.
export type CarrierWarning = "potential_fraud";

export const CARRIER_WARNING_LABEL: Record<CarrierWarning, string> = { potential_fraud: "Warning: Potential Fraud" };

export function isCarrierWarning(value: unknown): value is CarrierWarning {
  return typeof value === "string" && value in CARRIER_WARNING_LABEL;
}

/** The finding handed to Magnum DI and shown with the result. */
export function carrierWarningFinding(warning: CarrierWarning): string {
  return `The person reported that their mobile carrier labelled this call “${CARRIER_WARNING_LABEL[warning]}”. ApolloSG did not see the label itself.`;
}
