// Plain-text renderings of one Magnum DI transaction, for the Copy buttons on the DI tab.
// Pure: it only restates what the stored record already holds — nothing is re-derived, re-analysed
// or added, and attachment bodies are never included (only the recorded metadata).

import { formatBytes, provenanceLabel, type DiTransaction } from "./diTransaction.ts";

const line = (label: string, value: string | number | null | undefined) =>
  `${label}: ${value === null || value === undefined || value === "" ? "not recorded" : value}`;

function header(record: DiTransaction): string[] {
  return [
    line("Investigation ID", record.investigationId),
    line("Engine", record.engine),
    line("Environment", record.environment),
    line("Call", `${record.mode}${record.simulated ? " (no AI call was made)" : " (live AI call)"}`),
    line("Date/time", record.occurredAt),
  ];
}

/** Everything the DI "Sent to the AI tool" card shows. */
export function diRequestText(record: DiTransaction): string {
  const r = record.request;
  const attachments = (r.attachments ?? []).map((a, i) => [
    `Attachment ${i + 1}`,
    `  ${line("Type", a.mimeType)}`,
    `  ${line("Size", formatBytes(a.sizeBytes))}`,
    ...(a.dimensions ? [`  ${line("Dimensions", `${a.dimensions.width} × ${a.dimensions.height}`)}`] : []),
    `  ${line("Privacy screening", a.privacyScreening)}`,
    `  ${line("Redaction", a.redactionStatus)}`,
    `  ${line("Transmitted form", a.transmittedForm)}`,
  ].join("\n"));

  return [
    "APOLLO — SENT TO THE AI TOOL (Deep Investigation request)",
    "",
    ...header(record),
    "",
    "QUESTION AND EVIDENCE SENT",
    r.investigationPrompt || "not recorded",
    "",
    line("Tools", (r.tools ?? []).join(", ") || "none"),
    line("Attachments", String(r.attachmentCount ?? 0)),
    ...(attachments.length ? ["", ...attachments] : []),
    "",
    line("Payload size", formatBytes(r.requestBytes ?? null)),
  ].join("\n");
}

/** Everything the DI response card shows, with the recorded processing statistics. */
export function diResponseText(record: DiTransaction): string {
  const p = record.processing;
  const tokenNote = provenanceLabel(!!p.tokensAreSimulated, p.tokensAreEstimates);
  return [
    `APOLLO — ${record.simulated ? "SIMULATOR RESPONSE" : "AI RESPONSE"} (Deep Investigation)`,
    "",
    ...header(record),
    line("Status", record.failureCode ? `${record.status ?? "failed"} (${record.failureCode})` : record.status),
    "",
    "COMPLETE RESPONSE",
    record.response.text || "not recorded",
    "",
    line("Finish reason", record.response.finishReason),
    "",
    "PROCESSING",
    `${line("Prompt tokens", p.promptTokens)} (${tokenNote})`,
    `${line("Output tokens", p.outputTokens)} (${tokenNote})`,
    `${line("Total tokens", p.totalTokens)} (${tokenNote})`,
    line("Cached tokens", p.cachedTokens),
    line("Cache status", p.cacheStatus),
    line("Payload size", formatBytes(p.requestBytes ?? null)),
    line("Duration", p.durationMs == null ? null : `${p.durationMs} ms`),
    line("AI calls", String(p.geminiCalls ?? 0)),
    line("Retries", String(p.retries ?? 0)),
    line("Cost", p.cost?.amountUsd == null ? null : `US$${p.cost.amountUsd.toFixed(6)}`),
    record.simulated
      ? "Cost basis: simulated — not AI billing. No AI call was made."
      : `Cost basis: ${p.cost?.basis === "estimated" ? "estimated" : "recorded"}${p.cost?.note ? ` — ${p.cost.note}` : ""}`,
  ].join("\n");
}
