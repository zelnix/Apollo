// Gate 3 Phase B — page-content rule engine. Input: security signals Gemini extracted from a page
// screenshot (never the raw image). Output: scenario + dog state + plain-language reasons.
// Principles: a permission request alone isn't malicious; small/new/cheap ≠ fraudulent; never claim
// the device is infected or funds are gone without evidence.

import { assessBrand } from "./brand.ts";
import type { ApolloState } from "./types";

export interface PageSignals {
  visible_url: string;
  claimed_brand: string;
  page_type: string;
  asks_for: string[];
  virus_or_infection_claim: boolean;
  phone_number_to_call: string;
  remote_access_tool: string;
  captcha_instructions: string;
  wallet_connect_request: boolean;
  urgency_or_threat_text: string;
  prices_look_unrealistic: boolean;
  payment_methods: string[];
  business_identity: string;
  os_or_security_branding: string;
  text_excerpt: string;
}

export type PageScenario = "W02" | "W03" | "W08" | "W09" | "W10" | "W11" | "W12" | "W14" | "W17" | "W18" | "W20";

export interface PageAnalysis {
  scenario: PageScenario;
  title: string;
  state: ApolloState;
  verdict: string;
  why: string[];
  recommendation: string;
  /** Phone number the page pushes the user to call — handed to Gate 4 via recovery "called". */
  phoneToAvoid: string | null;
  claimedBrand: string | null;
  host: string | null;
}

const hostOf = (u: string) => { const m = u.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0]; return m && m.includes(".") ? m : null; };

export function analysePage(p: PageSignals, urlHint?: string | null): PageAnalysis {
  const host = hostOf(p.visible_url) ?? (urlHint ? hostOf(urlHint) : null);
  const asks = new Set(p.asks_for.map((a) => a.toLowerCase()));
  const wantsCreds = asks.has("password") || asks.has("bank_login") || asks.has("verification_code") || asks.has("username");
  const brand = host ? assessBrand(host, p.claimed_brand || null) : null;
  const claimed = brand?.claimed?.name ?? (p.claimed_brand || null);
  const mismatch = !!brand?.mismatch; // only KNOWN organisations can mismatch; an unfamiliar shop name is not evidence
  const urgent = !!p.urgency_or_threat_text;
  const risky = (pm: string) => /crypto|gift|western|moneygram|bank transfer only|wire/.test(pm);
  const base = { phoneToAvoid: p.phone_number_to_call || null, claimedBrand: claimed, host };

  // W14 / W09 — remote access or "call this number" on a security scare
  if (p.remote_access_tool || (asks.has("install") && (p.virus_or_infection_claim || p.page_type === "tech_support"))) {
    return { ...base, scenario: "W14", title: "Remote access software prompt", state: "barking", verdict: "This page wants you to install software so someone can 'fix' your device — don't.",
      why: [p.remote_access_tool ? `It names a remote-access tool (${p.remote_access_tool}).` : "It asks you to install an app or tool.", p.virus_or_infection_claim ? "It claims your device is infected — Apollo has no evidence of that." : "It pairs the request with a security scare.", p.phone_number_to_call ? `It gives a number to call (${p.phone_number_to_call}).` : "Real support never reaches you through a web page like this."],
      recommendation: "Don't install anything, share your screen or call the number. Close the tab. If you already installed it, use the recovery steps." };
  }
  if (p.page_type === "tech_support" || (p.phone_number_to_call && (p.virus_or_infection_claim || p.os_or_security_branding || urgent))) {
    return { ...base, scenario: "W09", title: "Fake technical support", state: "barking", verdict: "This looks like a fake technical-support page.",
      why: [p.os_or_security_branding ? `It uses ${p.os_or_security_branding} security branding — those companies don't show phone numbers in browser pop-ups.` : "It impersonates a support service.", p.phone_number_to_call ? `It urges you to call ${p.phone_number_to_call}.` : "It urges you to call immediately.", p.virus_or_infection_claim ? "It claims your device is compromised. That's a claim, not evidence." : (p.urgency_or_threat_text ? `It pressures you: "${p.urgency_or_threat_text}"` : "It uses urgency.")],
      recommendation: "Don't call the number or install anything it recommends. Close the browser tab. Your phone isn't broken." };
  }
  if (p.virus_or_infection_claim || (p.page_type === "security_warning" && (urgent || asks.has("download") || asks.has("phone_call")))) {
    return { ...base, scenario: "W08", title: "Fake virus warning", state: "barking", verdict: "This looks like a fake security warning.",
      why: ["A web page says your device is infected — browsers can't scan your phone, so this is theatre.", p.os_or_security_branding ? `It borrows ${p.os_or_security_branding} branding.` : "It imitates a system alert.", asks.has("download") || asks.has("install") ? "It wants you to download or install something." : (p.urgency_or_threat_text ? `It pressures you: "${p.urgency_or_threat_text}"` : "It uses urgency.")],
      recommendation: "Do not call the number or install anything it recommends. Close the tab — nothing on your phone has changed." };
  }
  if (p.wallet_connect_request || asks.has("wallet_connect") || p.page_type === "wallet") {
    return { ...base, scenario: "W12", title: "Crypto wallet access request", state: "barking", verdict: "This website is asking for access to your crypto wallet.",
      why: ["It asks you to connect a wallet or approve a transaction.", mismatch || !brand?.isOfficial ? `${host ?? "The site"} isn't a wallet or exchange Apollo recognises as official.` : "Unsolicited wallet requests are how drainers work.", urgent ? `It pressures you: "${p.urgency_or_threat_text}"` : "Approving gives the site permission to move your funds."],
      recommendation: "Don't connect or approve anything. Apollo has no evidence funds were taken — if you already approved, revoke the permission from your wallet app now." };
  }
  if (p.captcha_instructions || (p.page_type === "captcha" && (asks.has("download") || asks.has("install") || asks.has("permission")))) {
    return { ...base, scenario: "W18", title: "Fake 'verify you are human' step", state: asks.has("download") || asks.has("install") || /paste|run|command|terminal|powershell/i.test(p.captcha_instructions) ? "barking" : "growling", verdict: "A real CAPTCHA never asks you to download, install or paste anything.",
      why: [p.captcha_instructions ? `It says: "${p.captcha_instructions}"` : "It hides an install or permission step behind a human check.", "That's how malware gets installed by hand.", host ? `Website: ${host}.` : "The address isn't visible."],
      recommendation: "Don't follow the instructions. Close the tab. If you ran or installed something, use the recovery steps." };
  }
  if ((p.page_type === "login" || wantsCreds) && (mismatch || (!!claimed && host && !brand?.isOfficial))) {
    const bankish = /bank|paypal|commbank|westpac|anz|nab/i.test(claimed ?? "");
    return { ...base, scenario: bankish ? "W02" : "W03", title: bankish ? "Fake bank login" : `Fake ${claimed ?? "brand"} login`, state: "barking", verdict: `This page appears to impersonate ${claimed ?? "a known organisation"}.`,
      why: [`It presents as ${claimed ?? "a known organisation"}.`, host ? `It lives at ${host}, which isn't one of their official domains.` : "The real address isn't visible.", wantsCreds ? "It asks for login details or a verification code." : "It's a sign-in page."],
      recommendation: "Do not enter your login or verification code. Open the organisation's official app or type its address yourself." };
  }
  if (wantsCreds && !claimed) {
    return { ...base, scenario: "W17", title: "Credential request on an unknown page", state: asks.has("verification_code") || asks.has("bank_login") ? "barking" : "growling", verdict: "This page asks for login details without a clear, matching identity.",
      why: [`It asks for: ${[...asks].join(", ")}.`, host ? `Website: ${host}.` : "The address isn't visible.", urgent ? `It pressures you: "${p.urgency_or_threat_text}"` : "Apollo can't tell who is behind it."],
      recommendation: "Don't enter anything unless you navigated here yourself and recognise the address." };
  }
  if (p.page_type === "payment" || asks.has("card") || asks.has("payment")) {
    const suspicious = mismatch || p.payment_methods.some(risky) || urgent;
    return { ...base, scenario: "W11", title: "Payment page", state: suspicious ? (mismatch ? "barking" : "growling") : "ears_up", verdict: suspicious ? "This payment page looks suspicious." : "A payment page — check it's the business you meant.",
      why: [mismatch ? `It presents as ${claimed} but the address doesn't belong to them.` : (claimed ? `It presents as ${claimed}.` : "No clear business identity."), p.payment_methods.some(risky) ? `Unusual payment method: ${p.payment_methods.filter(risky).join(", ")}.` : (p.payment_methods.length ? `Payment by ${p.payment_methods.join(", ")}.` : "Payment method not visible."), urgent ? `It pressures you: "${p.urgency_or_threat_text}"` : "Only pay on a site you navigated to yourself."],
      recommendation: suspicious ? "Don't enter card details here. Pay through the official app or a site you typed yourself." : "If you didn't get here from a message link and the business matches, it's probably fine — use a card, not a transfer." };
  }
  if (p.page_type === "shop") {
    const flags = [p.prices_look_unrealistic ? "Prices look unrealistically low." : "", p.payment_methods.some(risky) ? `Unusual payment methods: ${p.payment_methods.filter(risky).join(", ")}.` : "", mismatch ? `Uses ${claimed} branding on an unrelated address.` : "", !p.business_identity ? "No business address, ABN or contact details visible." : ""].filter(Boolean);
    const state: ApolloState = mismatch || flags.length >= 3 ? "growling" : flags.length >= 1 ? "ears_up" : "resting";
    return { ...base, scenario: "W10", title: state === "resting" ? "Online shop" : "Possible fake shop", state, verdict: state === "resting" ? "Nothing suspicious about this shop from what Apollo can see." : state === "ears_up" ? "Apollo isn't sure about this shop yet." : "This shop shows several warning signs.",
      why: flags.length ? flags : ["Business details are shown.", "Prices look ordinary.", "Standard payment methods."],
      recommendation: state === "resting" ? "Small or new doesn't mean fraudulent. Pay by card (not transfer) so you can dispute if needed." : "Look the business up independently before paying. Pay by card, never bank transfer or crypto." };
  }
  return { ...base, scenario: "W20", title: "Ordinary web page", state: "resting", verdict: "Apollo sees nothing suspicious on this page.",
    why: ["No security scare or impersonation.", "No request for passwords, codes or payment.", "No install, download or wallet request."],
    recommendation: "Nothing to do. Ads and trackers are a privacy matter, not a security threat." };
}
