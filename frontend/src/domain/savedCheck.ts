// Saved Checks — on-device snapshots of completed link / message / internet checks the person can
// reopen later. Pure builder (testable); nothing here touches the network. Snapshots keep the honest
// wording that was shown; a saved check is a record of that check, never a renewed safety guarantee.
import type { ApolloState } from "./types";

export type CheckGate = "link" | "message" | "network";
export const GATE_LABEL: Record<CheckGate, string> = { link: "Link check", message: "Message check", network: "Internet check" };

export interface SavedCheckSection { title: string; lines: string[] }
export interface SavedCheck { id: string; gate: CheckGate; savedAt: string; title: string; subject: string; state: ApolloState; stateName: string; summary: string; recommendation: string; sections: SavedCheckSection[] }
export type SavedCheckInput = Omit<SavedCheck, "savedAt">;

export function buildSavedCheck(input: SavedCheckInput, now = Date.now()): SavedCheck {
  return { ...input, sections: input.sections.filter((s) => s.lines.length > 0), savedAt: new Date(now).toISOString() };
}
