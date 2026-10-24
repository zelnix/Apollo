// The Higgins health check's AI-service lines, from Apollo's saved records only (no test call is made).
import type { ProviderStatus } from "./systemHealthTypes";

const FAILURE_TEXT: Record<string, string> = {
  provider_configuration: "the AI service isn't set up correctly — often its billing or key",
  rate_limited: "the AI service was busy",
  provider_unavailable: "the AI service didn't respond",
  timeout: "it took too long",
  response_invalid: "the answer came back in a form Apollo couldn't read",
};

export function providerStatusLines(status: ProviderStatus | null | undefined, locale?: string): string[] {
  if (!status) return [];
  const key = status.keyConfigured ? "AI service key: set." : "AI service key: not set, so Magnum DI can't investigate.";
  const call = status.lastCall;
  if (!call) return [key, "Last Gemini call: none recorded yet."];
  const when = call.at && Number.isFinite(Date.parse(call.at)) ? new Date(call.at).toLocaleString(locale) : "time not recorded";
  const outcome = call.worked ? "it worked" : `it failed — ${FAILURE_TEXT[call.failureCode ?? ""] ?? "the reason wasn't recorded"}`;
  return [key, `Last Gemini call: ${when} — ${outcome}.`];
}
