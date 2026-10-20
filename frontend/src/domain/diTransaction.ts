// The Deep Investigation (DI) transaction: Magnum DI's real processing record for a case — what was
// prepared for Gemini, what the provider (live Gemini, or the preview simulator) returned, and the
// processing statistics. It is NOT evidence: evidence stays the original source Apollo received.

export interface DiAttachment {
  mimeType: string;
  sizeBytes: number;
  dimensions?: { width: number; height: number };
  privacyScreening: string;
  redactionStatus: string;
  transmittedForm: string;
}

export interface DiTransaction {
  investigationId: string;
  engine: string;
  environment: string;
  modelRequested: string | null;
  mode: "Live" | "Simulated";
  simulated: boolean;
  status: string | null;
  failureCode: string | null;
  occurredAt: string | null;
  request: {
    systemPrompt?: string;
    investigationPrompt?: string;
    attachments?: DiAttachment[];
    attachmentCount?: number;
    tools?: string[];
    requestBytes?: number;
  };
  response: { text?: string; finishReason?: string | null };
  processing: {
    promptTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    cachedTokens?: number | null;
    tokensAreEstimates?: boolean;
    tokensAreSimulated?: boolean;
    attachmentCount?: number;
    requestBytes?: number | null;
    durationMs?: number | null;
    geminiCalls?: number | null;
    retries?: number | null;
    cacheStatus?: string | null;
    cost?: { amountUsd?: number; basis?: string; note?: string };
  };
  notice: string | null;
}

/** How a number should be labelled in the DI tab: measured, estimated, or simulated. */
export function provenanceLabel(simulated: boolean, estimated: boolean | undefined): string {
  if (simulated) return "Simulated";
  return estimated ? "Estimated" : "Measured";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "not recorded";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
