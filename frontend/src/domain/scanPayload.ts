// Gate 5 — Scan Engine: decode → classify → preview → hand off. Never opens anything itself.
// Physical-context mismatch: what the sign/poster claims vs where the code actually leads.

import { assessBrand, registrableDomain } from "./brand.ts";
import type { ApolloState } from "./types";

export type PayloadType = "url" | "tel" | "sms" | "mailto" | "wifi" | "crypto" | "payment" | "applink" | "geo" | "vcard" | "text";
export type ScanContext = "parking" | "menu" | "parcel" | "government" | "payment" | "event" | "poster" | "email" | "other";
export const SCAN_CONTEXTS: { id: ScanContext; label: string }[] = [
  { id: "parking", label: "Parking sign" }, { id: "menu", label: "Restaurant menu" }, { id: "parcel", label: "Parcel / delivery notice" }, { id: "government", label: "Government / fine / tax" },
  { id: "payment", label: "Pay a business" }, { id: "event", label: "Event / ticket" }, { id: "poster", label: "Poster / ad" }, { id: "email", label: "In an email or message" }, { id: "other", label: "Not sure" },
];

export interface ScanPayload {
  type: PayloadType;
  raw: string;
  /** One line: "This code wants to open example.com" */
  preview: string;
  url?: string; host?: string;
  phone?: string; smsBody?: string; email?: string; subject?: string;
  ssid?: string; wifiSecurity?: string;
  cryptoAddress?: string; cryptoAsset?: string; amount?: string;
  appScheme?: string;
  text?: string;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase(); } };

export function classifyPayload(rawIn: string): ScanPayload {
  const raw = rawIn.trim();
  const lower = raw.toLowerCase();
  if (/^wifi:/i.test(raw)) {
    const ssid = /S:([^;]*)/i.exec(raw)?.[1] ?? "?"; const sec = /T:([^;]*)/i.exec(raw)?.[1] ?? "nopass";
    return { type: "wifi", raw, ssid, wifiSecurity: sec.toLowerCase() === "nopass" || !sec ? "open" : sec.toUpperCase(), preview: `This code contains Wi‑Fi credentials for “${ssid}”.` };
  }
  if (/^tel:/i.test(raw)) { const phone = raw.slice(4).trim(); return { type: "tel", raw, phone, preview: `This code wants to call ${phone}.` }; }
  if (/^(sms|smsto):/i.test(raw)) { const rest = raw.replace(/^(sms|smsto):/i, ""); const [phone, ...body] = rest.split(/[:?]/); return { type: "sms", raw, phone, smsBody: body.join(":").replace(/^body=/i, ""), preview: `This code wants to prepare a text message to ${phone}.` }; }
  if (/^mailto:/i.test(raw)) { const [email, q] = raw.slice(7).split("?"); const subject = /subject=([^&]*)/i.exec(q ?? "")?.[1]; return { type: "mailto", raw, email, subject: subject ? decodeURIComponent(subject) : undefined, preview: `This code wants to open an email to ${email}.` }; }
  if (/^(bitcoin|ethereum|litecoin|dogecoin|solana):/i.test(raw)) { const asset = raw.split(":")[0]; const addr = raw.split(":")[1].split("?")[0]; const amount = /amount=([^&]*)/i.exec(raw)?.[1]; return { type: "crypto", raw, cryptoAsset: asset, cryptoAddress: addr, amount, preview: `This is a ${asset} transfer destination${amount ? ` for ${amount}` : ""}.` }; }
  if (/^geo:/i.test(raw)) return { type: "geo", raw, preview: "This code points to a map location.", text: raw.slice(4) };
  if (/^begin:vcard/i.test(raw)) return { type: "vcard", raw, preview: "This code contains contact details.", text: raw };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) { const scheme = raw.split(":")[0]; return { type: "applink", raw, appScheme: scheme, preview: `This code wants to open the “${scheme}” app.` }; }
  if (/^https?:\/\//i.test(raw) || /^(?:[a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(raw)) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; const host = hostOf(url);
    const payment = /pay|checkout|invoice|billing|payid|upi|fee/i.test(url) || /^(?:www\.)?(paypal\.me|beemit|payid)/.test(host);
    return { type: payment ? "payment" : "url", raw, url, host, preview: payment ? `This appears to be a payment request via ${host}.` : `This code wants to open ${host}.` };
  }
  return { type: "text", raw, text: raw, preview: "This code only contains text. Nothing to open." };
}

export interface ScanAssessment { state: ApolloState; title: string; why: string[]; recommendation: string; claimedBrand: string | null; handoff: "web" | "call" | "network" | "app" | "none" }

// Known official destinations per physical context (independently maintained — never from the code itself).
const CONTEXT_OFFICIAL: Partial<Record<ScanContext, string[]>> = {
  parking: ["wilsonparking.com.au", "secureparking.com.au", "easypark.com.au", "paystay.com.au", "cellopark.com.au", "parkmobile.com.au", "carepark.com.au"],
  parcel: ["auspost.com.au", "startrack.com.au", "dhl.com", "fedex.com", "tollgroup.com", "aramex.com.au", "couriersplease.com.au"],
  government: ["gov.au"],
  menu: ["mryum.com", "meandu.com", "beamy.com.au", "squareup.com", "square.site", "order.online", "ubereats.com", "doordash.com", "menulog.com.au"],
};
const officialFor = (host: string, ctx: ScanContext) => (CONTEXT_OFFICIAL[ctx] ?? []).some((d) => host === d || host.endsWith(`.${d}`));

/** Pre-web assessment from payload type + physical context. URL payloads are then handed to Gate 3 (checkLink) for reputation/brand. */
export function assessScan(p: ScanPayload, context: ScanContext): ScanAssessment {
  if (p.type === "url" || p.type === "payment") {
    const host = p.host ?? ""; const brand = assessBrand(host); const reg = registrableDomain(host);
    const why: string[] = [];
    let state: ApolloState = "resting";
    if (brand.mismatch) { why.push(`It looks like ${brand.claimed!.name} but ${reg} isn't one of their official domains.`); state = "barking"; }
    const strictCtx = context === "parking" || context === "parcel" || context === "government";
    const known = officialFor(host, context) || brand.isOfficial;
    if (strictCtx && !known) {
      const what = { parking: "the parking service on the sign", parcel: "a delivery company", government: "a government service" }[context];
      const payish = p.type === "payment" || /pay|fee|card|checkout|verify|login/i.test(p.url ?? "");
      why.push(`The sign says it's for ${what}, but the code leads to ${reg}, which isn't a destination Apollo knows for that service.${payish ? " It also asks for a payment or details." : ""}`);
      if (state === "resting") state = payish ? "growling" : "ears_up";
    }
    if (known && state === "resting") { why.push(`${reg} is a known destination for this kind of code.`); return { state, title: "Looks okay so far", why, recommendation: "Apollo checks the destination before you open it.", claimedBrand: brand.claimed?.name ?? null, handoff: "web" }; }
    if (p.type === "payment" && !(context === "menu" && officialFor(host, "menu"))) { why.push("It's a payment request — check the recipient before paying."); if (state === "resting") state = "ears_up"; }
    if (context === "email") { why.push("QR codes inside emails are a common way to sneak past link filters."); if (state === "resting") state = "ears_up"; }
    return { state, title: state === "resting" ? "Looks okay so far" : state === "barking" ? `Possible fake ${brand.claimed?.name ?? "site"}` : "Suspicious destination", why: why.length ? why : ["No brand or context mismatch.", "Apollo will check the destination's reputation before you open it."],
      recommendation: state === "barking" ? "Don't open it or enter any details. Use the organisation's official app instead." : state === "growling" ? "Don't open it. Use the official app or website for the service on the sign." : "Apollo checks the destination before you open it.", claimedBrand: brand.claimed?.name ?? null, handoff: "web" };
  }
  if (p.type === "tel") return { state: "ears_up", title: "Phone call request", why: ["A code that dials a number can lead to premium or scam lines.", "Apollo does not call automatically — you decide."], recommendation: "Check the number first. Only call if you know who it is.", claimedBrand: null, handoff: "call" };
  if (p.type === "sms") return { state: "ears_up", title: "Pre-filled text message", why: [`It would text ${p.phone}${p.smsBody ? ` with: “${p.smsBody.slice(0, 80)}”` : ""}.`, "Pre-filled texts can sign you up to paid services."], recommendation: "Don't send it unless you know the recipient.", claimedBrand: null, handoff: "none" };
  if (p.type === "wifi") return p.wifiSecurity === "open" ? { state: "ears_up", title: "Open Wi‑Fi network", why: [`Network “${p.ssid}” has no password.`, "Open networks can be watched or impersonated."], recommendation: "Avoid banking on this network. Use mobile data for anything sensitive.", claimedBrand: null, handoff: "network" }
    : { state: "resting", title: "Wi‑Fi network details", why: [`Network “${p.ssid}” uses ${p.wifiSecurity} security.`, "No known risk in the code itself."], recommendation: "Connect through your phone's normal Wi‑Fi settings if you trust the venue.", claimedBrand: null, handoff: "network" };
  if (p.type === "crypto") return { state: context === "poster" || context === "email" ? "growling" : "ears_up", title: "Crypto transfer destination", why: [`A ${p.cryptoAsset} address${p.amount ? ` requesting ${p.amount}` : ""}.`, "Crypto payments can't be reversed.", context === "poster" || context === "email" ? "Unsolicited crypto requests in ads or emails are a scam pattern." : "A crypto address isn't dangerous by itself."], recommendation: "Only send if you initiated this payment and verified the recipient elsewhere.", claimedBrand: null, handoff: "none" };
  if (p.type === "applink") return { state: "ears_up", title: "Opens another app", why: [`It targets the “${p.appScheme}” app.`, "Apollo can't see what the app will do with it."], recommendation: "Only continue if you expected this code to open that app.", claimedBrand: null, handoff: "app" };
  if (p.type === "mailto") return { state: "resting", title: "Email draft", why: [`To: ${p.email}${p.subject ? ` — “${p.subject}”` : ""}.`, "Nothing is sent until you choose to."], recommendation: "Fine to continue if you recognise the address.", claimedBrand: null, handoff: "none" };
  return { state: "resting", title: p.type === "text" ? "Plain text" : "Information only", why: ["No link, call, payment or install.", "Shown safely below."], recommendation: "Nothing to do.", claimedBrand: null, handoff: "none" };
}
