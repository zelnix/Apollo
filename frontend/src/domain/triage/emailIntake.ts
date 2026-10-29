// Email intake on the device: turning an original message into the input of the on-device email engine.
// Pure, no Expo imports. The original itself never leaves the device.

import type { EmailHeaderEvidence } from "../emailAnalysis.ts";
import { emailAuthSummary } from "./emailEvidence.ts";
import type { ParsedOriginal } from "./emailOriginal.ts";

/** The engine reads From / Reply-To / Subject / Attachments lines and the body — taken here from the original's
 *  real headers and decoded MIME parts, never from the raw source text. */
export function analysisSourceFor(parsed: ParsedOriginal): { raw: string; fields: { from: string; subject: string } } {
  const t = parsed.technical;
  const from = t.from ? [t.from.name ? `"${t.from.name.replace(/"/g, "")}"` : null, t.from.address ? `<${t.from.address}>` : null].filter(Boolean).join(" ") : "";
  const lines = [
    from ? `From: ${from}` : null,
    t.replyTo.length ? `Reply-To: ${t.replyTo.map((r) => r.address ?? r.name).join(", ")}` : null,
    t.subject ? `Subject: ${t.subject}` : null,
    t.attachments.length ? `Attachments: ${t.attachments.map((a) => a.name).join(", ")}` : null,
  ].filter((l): l is string => !!l);
  const links = t.urls.filter((u) => !parsed.bodyText.includes(u));
  const body = [parsed.bodyText, links.length ? links.join("\n") : ""].filter(Boolean).join("\n\n");
  return { raw: `${lines.join("\n")}\n\n${body}`, fields: { from, subject: t.subject ?? "" } };
}

/** What the original's headers tell the email engine: whether it had them, and what the receiving server recorded. */
export function headerEvidenceFor(parsed: ParsedOriginal): EmailHeaderEvidence {
  const auth = parsed.fullHeaders ? emailAuthSummary(parsed.technical) : null;
  return { fullHeaders: parsed.fullHeaders, auth: auth ? { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc } : null };
}
