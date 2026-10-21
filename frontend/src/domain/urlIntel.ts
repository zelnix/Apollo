// URL reputation for links found inside a message or email.
//
// This is the DETECTION path only: the same `/intel/check` call a manual Check-a-Link makes, run
// over each link the material contains. It never opens an investigation case and never spends a
// Gemini call — Magnum DI is launched separately, and only when Triage escalates.

import { apiPost } from "@/src/api/client";
import { parseIntelResult } from "@/src/domain/intelContract";
import type { DomainInfo } from "@/src/domain/types";

export interface MessageUrlResult {
  url: string;
  host: string;
  verdict: "clean" | "malicious" | "unknown";
  threat_types: string[];
  coverage: string;
  redirect_chain?: string[];
  final_url?: string | null;
  domain_info?: DomainInfo | null;
}

export function hostOfUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
}

/** Reputation for up to `limit` links. A link the service could not answer for is still returned,
 *  with coverage "unavailable" — never silently dropped and never assumed clean. */
export async function fetchMessageUrlIntel(
  urls: string[],
  deviceId: string | null,
  limit = 5,
): Promise<MessageUrlResult[]> {
  const results: MessageUrlResult[] = [];
  for (const rawUrl of urls.slice(0, limit)) {
    try {
      const raw = await apiPost<unknown>("/intel/check", "intel_check", {
        indicator_type: "url",
        value: rawUrl,
        device_id: deviceId ?? undefined,
        expand: true,
      });
      const parsed = parseIntelResult(raw);
      if (parsed) {
        results.push({
          url: rawUrl,
          host: hostOfUrl(rawUrl),
          verdict: parsed.verdict === "malicious" ? "malicious" : parsed.verdict === "clean" ? "clean" : "unknown",
          threat_types: parsed.threat_types ?? [],
          // Real coverage from the reputation service. "none" means nothing could be checked —
          // it must never be recorded as a completed check.
          coverage: parsed.coverage === "none" ? "unavailable" : parsed.coverage,
          redirect_chain: parsed.redirect_chain ?? undefined,
          final_url: parsed.final_url ?? null,
          domain_info: parsed.domain_info ?? null,
        });
      }
    } catch {
      results.push({ url: rawUrl, host: hostOfUrl(rawUrl), verdict: "unknown", threat_types: [], coverage: "unavailable" });
    }
  }
  return results;
}

/** The deterministic link finding Triage reads. Null when the material carries no links. */
export function linkTriageOutcome(urls: MessageUrlResult[]): "POSSIBLE_THREAT_IDENTIFIED" | "LIMITED_UNABLE_TO_DETERMINE" | "NO_THREAT_IDENTIFIED" | null {
  if (urls.some((u) => u.verdict === "malicious")) return "POSSIBLE_THREAT_IDENTIFIED";
  if (urls.some((u) => u.coverage === "unavailable")) return "LIMITED_UNABLE_TO_DETERMINE";
  return urls.length ? "NO_THREAT_IDENTIFIED" : null;
}
