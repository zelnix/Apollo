import type { HigginsAssessment } from "./investigation";

export type InvestigationActionKind = HigginsAssessment["action_kind"];

export const INVESTIGATION_ACTION_LABEL: Record<InvestigationActionKind, string> = {
  verify_officially: "Show me how to check",
  call_known_number: "Show me how to call safely",
  check_account: "Open Account Gate",
  avoid_and_delete: "Clear submitted copy",
  review: "Show what to review",
};

export interface InvestigationActionHandlers {
  showVerification: () => void;
  showCallingGuidance?: () => void;
  openAccount: () => void;
  clearSubmittedCopy: () => void;
  showReview: () => void;
}

export function dispatchInvestigationAction(kind: InvestigationActionKind, handlers: InvestigationActionHandlers): void {
  if (kind === "verify_officially") handlers.showVerification();
  else if (kind === "call_known_number") (handlers.showCallingGuidance ?? handlers.showVerification)();
  else if (kind === "check_account") handlers.openAccount();
  else if (kind === "avoid_and_delete") handlers.clearSubmittedCopy();
  else handlers.showReview();
}