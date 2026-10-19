import * as Crypto from "expo-crypto";

import type { SharedPayload } from "./classifyShare";

type Intake = { payload: SharedPayload; expiresAt: number };

const TTL_MS = 15 * 60 * 1000;
const envelopes = new Map<string, Intake>();

function sweep() {
  const now = Date.now();
  for (const [id, intake] of envelopes) if (intake.expiresAt <= now) envelopes.delete(id);
}

/** Keeps original shared content out of route strings and retains every attachment until bounded expiry. */
export function putShareIntake(payload: SharedPayload): string {
  sweep();
  const id = Crypto.randomUUID();
  envelopes.set(id, { payload, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getShareIntake(id: string | null | undefined): SharedPayload | null {
  if (!id) return null;
  sweep();
  return envelopes.get(id)?.payload ?? null;
}

export function clearShareIntake(id: string) { envelopes.delete(id); }
