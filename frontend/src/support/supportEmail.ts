// Prepares the support email and hands it to the user's email app for review (spec §7/§9). Never
// sends automatically, never attaches logs automatically, never collects email credentials and never
// introduces a backend mailer. Prefers expo-mail-composer; falls back to a correctly-encoded mailto:;
// if neither is available the caller offers "Copy Support Summary" instead.
import * as MailComposer from "expo-mail-composer";
import { Linking } from "react-native";

export const SUPPORT_RECIPIENT = "support@harmonywellnessgroup.com.au";

export type EmailOutcome = "composed" | "mailto" | "unavailable";

/** Subject always begins with "Apollo" and carries the support reference (spec §7). */
export function supportSubject(reference: string): string {
  return `Apollo Support [${reference}]`;
}

/** mailto: with correct percent-encoding. Guards against an oversized URL silently truncating the body. */
const MAILTO_MAX = 1800;
export function buildMailto(reference: string, body: string): string | null {
  const subject = encodeURIComponent(supportSubject(reference));
  const url = `mailto:${SUPPORT_RECIPIENT}?subject=${subject}&body=${encodeURIComponent(body)}`;
  return url.length > MAILTO_MAX ? null : url;
}

export async function openSupportEmail(reference: string, body: string): Promise<EmailOutcome> {
  try {
    if (await MailComposer.isAvailableAsync()) {
      await MailComposer.composeAsync({ recipients: [SUPPORT_RECIPIENT], subject: supportSubject(reference), body });
      return "composed";
    }
  } catch { /* fall through to mailto */ }

  const mailto = buildMailto(reference, body);
  if (mailto && (await Linking.canOpenURL(mailto))) {
    await Linking.openURL(mailto);
    return "mailto";
  }
  // A full mailto would truncate the summary — hand back a short mailto so the user still gets a draft.
  const shortBody = `Support Reference: ${reference}\n\nPlease describe your issue here. Tap "Copy Support Summary" in Apollo and paste the details below.`;
  const shortMailto = buildMailto(reference, shortBody);
  if (shortMailto && (await Linking.canOpenURL(shortMailto))) {
    await Linking.openURL(shortMailto);
    return "mailto";
  }
  return "unavailable";
}
