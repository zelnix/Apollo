// One-use, process-memory transfer. Private findings never enter navigation URLs or persistent history.
import type { HigginsIssueContext } from './higginsHandoff';

const pending = new Map<string, { context: HigginsIssueContext; question: string; expiresAt: number }>();
export function storeHandoff(id: string, context: HigginsIssueContext, question: string) {
  for (const [key, value] of pending) if (value.expiresAt <= Date.now()) pending.delete(key);
  pending.set(id, { context, question, expiresAt: Date.now() + 15 * 60 * 1000 });
  setTimeout(() => pending.delete(id), 15 * 60 * 1000);
}
export function takeHandoff(id: string) {
  const value = pending.get(id);
  pending.delete(id);
  return value && value.expiresAt > Date.now() ? value : null;
}
export function clearHandoffTransfers() { pending.clear(); }