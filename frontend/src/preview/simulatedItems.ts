// Simulated selections for the PREVIEW ONLY — messages, calls, apps and files.
//
// Preview has no SMS list, no call log, no installed-app list and (for the samples below) nothing in
// the file picker, so these samples exist purely to provide INPUT to Apollo's real checks. Selecting
// one runs exactly the same check flow a real selection runs: the same on-device analysis, the same
// deterministic Triage, and the real Magnum DI investigation only where Triage escalates. There is
// no preview verdict, no mock Triage result and no alternative rule engine anywhere in this file.
//
// `probes` describes WHAT THE ITEM CONTAINS, never what Apollo will conclude about it.

import type { AppPermission, AppPurpose, AppSource } from "../domain/appAnalysis";

export interface SimulatedText {
  id: string;
  sender: string;
  text: string;
  probes: string;
}

export const SIMULATED_TEXTS: SimulatedText[] = [
  {
    id: "sim-txt-delivery-ok",
    sender: "AusPost",
    text: "Your parcel AP88213 was delivered to your front door at 2:14pm. Track future deliveries in the AusPost app you already have.",
    probes: "A plain delivery notice: no link, no request, no urgency.",
  },
  {
    id: "sim-txt-bank-verify",
    sender: "+61 448 221 905",
    text: "CommBank: A payment of $920.00 to CRYPTO EXCHANGE LTD is pending. If this wasn't you, cancel it now at http://commbank-cancel.co/stop and confirm your NetBank password.",
    probes: "Bank pretext with a lookalike link and a password request.",
  },
  {
    id: "sim-txt-toll-fine",
    sender: "Linkt-Notice",
    text: "LINKT: You have an unpaid toll of $4.85. A $65 fine will be issued today unless you pay at https://linkt-au-pay.top/settle",
    probes: "Toll pretext with a same-day fine threat and a lookalike payment link.",
  },
  {
    id: "sim-txt-family",
    sender: "+61 491 570 006",
    text: "Hi mum, I dropped my phone in the sink and this is my new number. I can't get into my banking app - can you pay my rent of $1,480 today and I'll fix it up Friday? Please don't ring, the mic is broken.",
    probes: "Family impersonation from a new number asking for a payment and discouraging a phone call.",
  },
  {
    id: "sim-txt-otp",
    sender: "Support",
    text: "Your verification code is 408 221. Reply with this code to confirm you own this number and release your refund.",
    probes: "Asks the recipient to reply with the one-time code they were sent.",
  },
  {
    id: "sim-txt-investment",
    sender: "+44 7700 900182",
    text: "Hi! Remember me from the trading group? My mentor is up 340% this month on AI coin. Minimum entry is only $250 and I can walk you through the wallet setup on WhatsApp.",
    probes: "Investment approach with an outsized return claim and a move to another messaging app.",
  },
];

export interface SimulatedCall {
  id: string;
  number: string;
  name: string | null;
  probes: string;
}

export const SIMULATED_CALLS: SimulatedCall[] = [
  { id: "sim-call-contact", number: "+61 3 9345 2000", name: "Royal Melbourne Hospital", probes: "A listed Australian landline that matches a saved contact." },
  { id: "sim-call-mobile", number: "+61 412 668 341", name: null, probes: "An unknown Australian mobile number." },
  { id: "sim-call-spoof-gov", number: "+61 2 6216 1111", name: null, probes: "A Canberra landline of the kind used when callers claim to be a government department." },
  { id: "sim-call-international", number: "+234 701 554 2298", name: null, probes: "An unexpected international number." },
  { id: "sim-call-premium", number: "1900 654 321", name: null, probes: "An Australian premium-rate number." },
];

export interface SimulatedApp {
  id: string;
  appName: string;
  packageId: string;
  developer: string;
  /** Where the person says it came from — the same answer the real screen collects. */
  source: AppSource;
  purpose: AppPurpose;
  /** The permissions the person says it has — the same answers the real screen collects. */
  permissions: AppPermission[];
  probes: string;
}

export const SIMULATED_APPS: SimulatedApp[] = [
  {
    id: "sim-app-store",
    appName: "ABC listen",
    packageId: "au.net.abc.listen",
    developer: "Australian Broadcasting Corporation",
    source: "play_store",
    purpose: "game_media",
    permissions: ["notifications"],
    probes: "A mainstream media app from an official store with one ordinary permission.",
  },
  {
    id: "sim-app-cleaner",
    appName: "Turbo Battery Saver Pro",
    packageId: "com.turbo.batterysaver.pro",
    developer: "TS Mobile Labs",
    source: "browser",
    purpose: "cleaner",
    permissions: ["accessibility", "overlay", "sms", "notifications", "device_admin"],
    probes: "A 'battery saver' downloaded from a website holding accessibility, overlay, SMS, notification and device-admin access.",
  },
  {
    id: "sim-app-remote",
    appName: "QuickAssist Remote",
    packageId: "com.quickassist.remote",
    developer: "Unknown",
    source: "message",
    purpose: "remote_support",
    permissions: ["screen_share", "accessibility", "files"],
    probes: "A remote-support tool sent to the person in a message, with screen sharing and accessibility access.",
  },
  {
    id: "sim-app-bank-lookalike",
    appName: "NAB Secure Banking",
    packageId: "com.nab.secure.banking.plus",
    developer: "NAB Security Services",
    source: "other_store",
    purpose: "banking",
    permissions: ["sms", "notifications", "contacts", "install_apps"],
    probes: "A banking app from a third-party store that can read texts and notifications and install other apps.",
  },
];

export interface SimulatedFile {
  id: string;
  name: string;
  mime: string;
  /** Real content written to a real temporary file so Apollo's own inspection reads real bytes. */
  content: string;
  probes: string;
}

export const SIMULATED_FILES: SimulatedFile[] = [
  {
    id: "sim-file-statement",
    name: "Statement_June.pdf",
    mime: "application/pdf",
    content: "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    probes: "A small PDF whose content matches its name and type.",
  },
  {
    id: "sim-file-double-ext",
    name: "Invoice_4471.pdf.exe",
    mime: "application/octet-stream",
    content: "MZ\u0090\u0000\u0003\u0000\u0000\u0000This program cannot be run in DOS mode.\n",
    probes: "A file named like a PDF whose real content is a Windows program.",
  },
  {
    id: "sim-file-macro",
    name: "Payroll_Update.docm",
    mime: "application/vnd.ms-word.document.macroEnabled.12",
    content: "PK\u0003\u0004macro-enabled document placeholder\n",
    probes: "A macro-enabled Word document.",
  },
  {
    id: "sim-file-archive",
    name: "Remittance_Advice.zip",
    mime: "application/zip",
    content: "PK\u0003\u0004archive placeholder\n",
    probes: "An archive attachment of the kind used to carry an executable past filters.",
  },
];

// ── Samples used by the Ask Higgins check sheet (preview only) ──────────────
//
// The categories in "What do you want to check?" collect typed input. In the preview there is
// nothing to paste from (no real inbox, no real gallery, no real call log), so these samples supply
// that INPUT. Selecting one only fills the field — the person still submits, and the submission runs
// Apollo's real Triage and, only where Triage escalates, the real Magnum DI investigation.

export interface SimulatedLink {
  id: string;
  url: string;
  probes: string;
}

export const SIMULATED_LINKS: SimulatedLink[] = [
  {
    id: "sim-link-known",
    url: "https://www.servicesaustralia.gov.au/mygov",
    probes: "A well-known Australian government domain.",
  },
  {
    id: "sim-link-bank-lookalike",
    url: "http://commbank-cancel.co/stop",
    probes: "A bank-lookalike domain served over plain http.",
  },
  {
    id: "sim-link-toll",
    url: "https://linkt-au-pay.top/settle",
    probes: "A toll-payment lookalike on an unusual top-level domain.",
  },
  {
    id: "sim-link-shortener",
    url: "https://bit.ly/3xRq7Kp",
    probes: "A shortened link that hides its destination.",
  },
  {
    id: "sim-link-punycode",
    url: "https://xn--myov-9na.net/login",
    probes: "A punycode domain that displays as a familiar name.",
  },
];

export interface SimulatedDeviceConcern {
  id: string;
  concern: string;
  probes: string;
}

export const SIMULATED_DEVICE_CONCERNS: SimulatedDeviceConcern[] = [
  {
    id: "sim-dev-none",
    concern: "Nothing specific — I just want my phone and internet connection checked.",
    probes: "A routine check with no reported symptom.",
  },
  {
    id: "sim-dev-remote",
    concern:
      "A man who said he was from my internet provider asked me to install an app so he could fix my connection, and my screen moved on its own while we were on the phone.",
    probes: "Reports remote access during an unsolicited support call.",
  },
  {
    id: "sim-dev-wifi",
    concern:
      "I joined a free wifi called 'Airport_Free_WiFi' at the shops and afterwards my banking app asked me to sign in again.",
    probes: "Reports an open public network followed by a re-authentication prompt.",
  },
  {
    id: "sim-dev-popups",
    concern:
      "My phone keeps showing pop-ups saying it is infected and the battery is going flat by lunchtime.",
    probes: "Reports persistent pop-ups and unusual battery drain.",
  },
];

export interface SimulatedScreenshot {
  id: string;
  label: string;
  /** Bundled image, resolved to a real local file before Apollo's real screening runs. */
  asset: number;
  question: string;
  probes: string;
}

export const SIMULATED_SCREENSHOTS: SimulatedScreenshot[] = [
  {
    id: "sim-shot-sms-bank",
    label: "Text message from +61 448 221 905",
    asset: require("../../assets/images/preview/sim-shot-sms-bank.png"),
    question: "Is this message from my bank real?",
    probes: "A bank pretext with a lookalike link, a password request and a 2-hour deadline.",
  },
  {
    id: "sim-shot-email-invoice",
    label: "Email about invoice 4471",
    asset: require("../../assets/images/preview/sim-shot-email-invoice.png"),
    question: "Should I pay this invoice?",
    probes: "An invoice with changed bank details, a reply-only instruction and a .pdf.exe attachment.",
  },
  {
    id: "sim-shot-delivery",
    label: "AusPost delivery notice",
    asset: require("../../assets/images/preview/sim-shot-delivery.png"),
    question: "Is this delivery message a scam?",
    probes: "A plain delivery notice: no link, no request, no urgency.",
  },
];
