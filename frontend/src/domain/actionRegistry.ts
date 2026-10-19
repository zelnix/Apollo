/**
 * Canonical Action / Reporting Link Registry.
 *
 * ONE source of truth for external action URLs (FTC, FCC, ACCC, Apple, Google, etc.).
 * Every adapter and screen imports from this file. No embedded URLs elsewhere.
 *
 * Architecture rule: a fact can appear in many places, but Apollo should
 * decide that fact in only one place.
 */

import type { ActionLink } from "./checkResult";

// ── Registry ─────────────────────────────────────────────────────────────────

export const ACTION_LINKS = {
  // US federal agencies
  ftc_report_fraud: { label: "Report fraud to the FTC", url: "https://reportfraud.ftc.gov" } as ActionLink,
  fcc_complaint: { label: "File a complaint with the FCC", url: "https://consumercomplaints.fcc.gov/hc/en-us" } as ActionLink,
  ftc_wifi_safety: { label: "Learn how to stay safe on public Wi-Fi", url: "https://consumer.ftc.gov/articles/how-safely-use-public-wi-fi-networks" } as ActionLink,
  ic3_report: { label: "Report to IC3 (FBI)", url: "https://www.ic3.gov/" } as ActionLink,
  ftc_identity_theft: { label: "Report identity theft", url: "https://www.identitytheft.gov" } as ActionLink,

  // Australian agencies
  accc_scamwatch: { label: "Report to Scamwatch (ACCC)", url: "https://www.scamwatch.gov.au/report-a-scam" } as ActionLink,
  acsc_report: { label: "Report to ACSC", url: "https://www.cyber.gov.au/report-and-recover/report" } as ActionLink,

  // Platform-specific
  apple_report_phishing: { label: "Report phishing to Apple", url: "https://support.apple.com/en-us/102568" } as ActionLink,
  google_report_phishing: { label: "Report phishing to Google", url: "https://safebrowsing.google.com/safebrowsing/report_phish/" } as ActionLink,
  google_play_report: { label: "Report to Google Play", url: "https://support.google.com/googleplay/answer/2853570" } as ActionLink,
  apple_app_store_report: { label: "Report to Apple App Store", url: "https://reportaproblem.apple.com" } as ActionLink,

  // Spam and text message reporting
  fcc_stop_texts: { label: "Report spam texts — forward to 7726 (SPAM)", url: "https://www.fcc.gov/consumers/guides/stop-unwanted-robocalls-and-texts" } as ActionLink,

  // Anti-phishing
  apwg_report: { label: "Report phishing email to Anti-Phishing Working Group", url: "mailto:reportphishing@apwg.org" } as ActionLink,

  // Breach checking
  hibp_check: { label: "Check if your email was in a breach", url: "https://haveibeenpwned.com" } as ActionLink,

  // Account security pages (platform-specific)
  google_account_security: { label: "Google account security", url: "https://myaccount.google.com/security" } as ActionLink,
  apple_account_manage: { label: "Apple ID account settings", url: "https://appleid.apple.com/account/manage" } as ActionLink,
  microsoft_password_reset: { label: "Microsoft password reset", url: "https://account.live.com/password/reset" } as ActionLink,
  facebook_security_settings: { label: "Facebook security settings", url: "https://www.facebook.com/settings?tab=security" } as ActionLink,
} as const;

/** Standard action links for fraud/scam results (FTC + FCC). */
export function fraudActionLinks(): ActionLink[] {
  return [ACTION_LINKS.ftc_report_fraud, ACTION_LINKS.fcc_complaint];
}

/** Standard action links for general scam results (FTC only). */
export function scamActionLinks(): ActionLink[] {
  return [ACTION_LINKS.ftc_report_fraud];
}

/** Standard action links for call-specific scam results (FTC + FCC). */
export function callScamActionLinks(): ActionLink[] {
  return [ACTION_LINKS.ftc_report_fraud, ACTION_LINKS.fcc_complaint];
}

/** Standard action links for network/Wi-Fi results. */
export function networkActionLinks(): ActionLink[] {
  return [ACTION_LINKS.ftc_wifi_safety];
}

/** Standard action links for identity theft results. */
export function identityTheftActionLinks(): ActionLink[] {
  return [ACTION_LINKS.ftc_identity_theft, ACTION_LINKS.ftc_report_fraud];
}
