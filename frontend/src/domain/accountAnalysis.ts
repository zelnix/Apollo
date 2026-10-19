// Gate 8 — Identity & Account Engine (Account Guard, AC01–AC20). Works from an alert the user pastes or
// describes plus what they tell Apollo (did you do this?). Distinguishes "something suspicious happened"
// from "your account is compromised". Never asks for or stores passwords.

import { extractSignals } from "./messageAnalysis.ts";
import type { ApolloState, EventCategory } from "./types";

export type AlertKind = "mfa_prompt" | "login_alert" | "password_reset" | "password_changed" | "recovery_changed" | "security_alert" | "breach_notice" | "locked_out" | "other";
export const ALERT_KINDS: { id: AlertKind; label: string }[] = [
  { id: "mfa_prompt", label: "“Approve this login?” (MFA prompt)" }, { id: "login_alert", label: "New login / new device alert" }, { id: "password_reset", label: "Password reset link or code" },
  { id: "password_changed", label: "“Your password was changed”" }, { id: "recovery_changed", label: "Recovery email / phone changed" }, { id: "security_alert", label: "Suspicious activity alert" },
  { id: "breach_notice", label: "Data breach notice" }, { id: "locked_out", label: "I'm locked out of the account" }, { id: "other", label: "Something else" },
];
export type AccountProvider = "microsoft" | "google" | "apple" | "bank" | "paypal" | "facebook" | "mygov" | "other";
export const ACCOUNT_PROVIDERS: { id: AccountProvider; label: string; brand: string | null; official: string[] }[] = [
  { id: "microsoft", label: "Microsoft", brand: "Microsoft", official: ["microsoft.com", "live.com", "microsoftonline.com", "outlook.com", "office.com"] },
  { id: "google", label: "Google", brand: "Google", official: ["google.com", "gmail.com", "youtube.com", "goog.le"] },
  { id: "apple", label: "Apple", brand: "Apple", official: ["apple.com", "icloud.com"] },
  { id: "bank", label: "My bank", brand: null, official: ["commbank.com.au", "westpac.com.au", "anz.com", "anz.com.au", "nab.com.au"] },
  { id: "paypal", label: "PayPal", brand: "PayPal", official: ["paypal.com", "paypal.com.au"] },
  { id: "facebook", label: "Facebook / Instagram", brand: "Facebook", official: ["facebook.com", "fb.com", "instagram.com", "meta.com"] },
  { id: "mygov", label: "myGov / government", brand: "myGov", official: ["my.gov.au", "servicesaustralia.gov.au", "ato.gov.au"] },
  { id: "other", label: "Other / not sure", brand: null, official: [] },
];

export interface AccountInput {
  kind: AlertKind; provider: AccountProvider; text?: string; sender?: string;
  /** Did you just log in / request this? true = yes, false = no, null = not sure. */
  userInitiated: boolean | null;
  repeated?: boolean; enteredPassword?: boolean; enteredCode?: boolean; unusualLocation?: boolean;
  recentScentCategories?: EventCategory[]; recentScentBrand?: string | null;
}
export type TakeoverRisk = "low" | "elevated" | "high" | "very_high";
export interface AccountAnalysis {
  scenario: string; title: string; state: ApolloState; verdict: string; why: string[]; recommendation: string;
  providerLabel: string; claimedBrand: string | null; urls: string[]; suspiciousUrls: string[]; takeoverRisk: TakeoverRisk;
  stayWithMe: boolean; recoveryKinds: string[]; handoff: "web" | "none"; openOfficial: string; technical: string[];
}
export interface AccountEvidence {
  kind: AlertKind;
  provider: AccountProvider;
  claimedService: string | null;
  visibleSender: string | null;
  urls: string[];
  requestedActions: string[];
}

/** Local evidence extraction. These are claims/visible facts, never authentication or proof. */
export function inspectAccountEvidence(text: string, sender = ""): AccountEvidence {
  const combined = `${sender}\n${text}`.trim();
  const lower = combined.toLowerCase();
  const sig = combined ? extractSignals(sender, text) : null;
  let kind: AlertKind = "other";
  if (/password (?:was |has been )?changed|changed your password/.test(lower)) kind = "password_changed";
  else if (/recovery (?:email|phone|details).*(?:changed|updated)|(?:email|phone).*(?:recovery).*(?:changed|updated)/.test(lower)) kind = "recovery_changed";
  else if (/data breach|breach notice|information (?:was|may have been) exposed/.test(lower)) kind = "breach_notice";
  else if (/approve (?:this |the )?(?:login|sign[- ]?in)|authentication request|mfa|two.factor prompt/.test(lower)) kind = "mfa_prompt";
  else if (/password reset|reset (?:your |the )?password|reset code/.test(lower)) kind = "password_reset";
  else if (/new (?:login|sign[- ]?in|device)|logged in from|sign[- ]?in from/.test(lower)) kind = "login_alert";
  else if (/locked out|account (?:is )?locked|can't (?:sign|log) in/.test(lower)) kind = "locked_out";
  else if (/security alert|suspicious (?:activity|sign[- ]?in)|unusual activity/.test(lower)) kind = "security_alert";
  let provider: AccountProvider = "other";
  if (/microsoft|outlook|office 365|live\.com/.test(lower)) provider = "microsoft";
  else if (/google|gmail|youtube/.test(lower)) provider = "google";
  else if (/apple|icloud/.test(lower)) provider = "apple";
  else if (/paypal/.test(lower)) provider = "paypal";
  else if (/facebook|instagram|meta/.test(lower)) provider = "facebook";
  else if (/mygov|services australia|ato\b/.test(lower)) provider = "mygov";
  else if (/commbank|westpac|\banz\b|\bnab\b|bank/.test(lower)) provider = "bank";
  return { kind, provider, claimedService: sig?.claimedBrand ?? ACCOUNT_PROVIDERS.find((item) => item.id === provider)?.brand ?? null,
    visibleSender: sender.trim() || null, urls: sig?.urls ?? [], requestedActions: sig?.requestedAction ? [sig.requestedAction] : [] };
}

function hostOf(u: string) { return u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase().replace(/^www\./, ""); }
export function isOfficialHost(host: string, official: string[]) { return official.some((d) => host === d || host.endsWith(`.${d}`)); }

const OPEN_OFFICIAL: Record<AccountProvider, string> = {
  microsoft: "Open account.microsoft.com yourself (type it) or the Microsoft Authenticator app — never a link from the message.",
  google: "Open myaccount.google.com yourself or the Gmail app → your profile → Manage your account → Security.",
  apple: "On your iPhone: Settings → your name → Sign-In & Security. Or type appleid.apple.com yourself.",
  bank: "Open your bank's official app, or call the number on the back of your card.",
  paypal: "Open the PayPal app or type paypal.com yourself → Settings → Security.",
  facebook: "Open the app → Settings → Accounts Centre → Password and security.",
  mygov: "Type my.gov.au yourself or open the myGov app. Government agencies never send login links by text.",
  other: "Open the service's official app, or type its address yourself. Never use a link or number from the alert.",
};

export function analyseAccountAlert(input: AccountInput): AccountAnalysis {
  const prov = ACCOUNT_PROVIDERS.find((p) => p.id === input.provider) ?? ACCOUNT_PROVIDERS[ACCOUNT_PROVIDERS.length - 1];
  const text = (input.text ?? "").trim();
  const sig = text ? extractSignals(input.sender ?? "", text) : null;
  const urls = sig?.urls ?? [];
  const suspiciousUrls = urls.filter((u) => prov.id === "other" || !isOfficialHost(hostOf(u), prov.official));
  const brand = prov.brand ?? sig?.claimedBrand ?? (prov.id === "bank" ? "your bank" : null);
  const claimedBrand = prov.brand ?? sig?.claimedBrand ?? null;
  const who = brand ?? "the service";
  const scent = new Set(input.recentScentCategories ?? []);
  const priorPhish = scent.has("message") || scent.has("website") || scent.has("link") || scent.has("call");
  const pressure = !!(sig?.urgency || sig?.threat);
  const technical = [`Alert type: ${ALERT_KINDS.find((k) => k.id === input.kind)?.label}`, `Provider: ${prov.label}`, `You initiated it: ${input.userInitiated === null ? "not sure" : input.userInitiated ? "yes" : "no"}`,
    `Links in alert: ${urls.length} (${suspiciousUrls.length} not on ${prov.id === "other" ? "a known official domain" : `${prov.label}'s official domains`})`, sig ? `Text signals: ${[sig.loginRequest && "login request", sig.codeRequest && "code request", sig.urgency && "urgency", sig.threat && "threat", sig.identityRequest && "identity request"].filter(Boolean).join(", ") || "none"}` : "No alert text shared",
    input.repeated ? "Repeated prompts" : "", input.enteredPassword ? "Password entered" : "", input.enteredCode ? "Code entered" : "", input.unusualLocation ? "Unusual location reported" : "", `Threat Scent context: ${scent.size ? [...scent].join(", ") : "none"}`].filter(Boolean);
  const R = (scenario: string, title: string, state: ApolloState, takeoverRisk: TakeoverRisk, verdict: string, why: string[], recommendation: string, extra: Partial<Pick<AccountAnalysis, "stayWithMe" | "recoveryKinds" | "handoff">> = {}): AccountAnalysis =>
    ({ scenario, title, state, verdict, why: why.filter(Boolean), recommendation, providerLabel: prov.label, claimedBrand, urls, suspiciousUrls, takeoverRisk, stayWithMe: extra.stayWithMe ?? false, recoveryKinds: extra.recoveryKinds ?? [], handoff: extra.handoff ?? "none", openOfficial: OPEN_OFFICIAL[prov.id], technical });
  const scentWhy = priorPhish ? [`Apollo saw a suspicious ${scent.has("call") ? "call" : "message or website"} about ${who} shortly before this (Threat Scent).`] : [];

  // AC12 — code entered on a phishing page: active takeover.
  if (input.enteredCode) return R("AC12", "Verification code shared", "barking", "very_high", `Treat this as an account takeover in progress. Whoever has the code can finish logging in as you — right now.`, ["A one-time code is the last lock on the door; sharing it opens it.", "Real services never ask you to type a code anywhere except their own app or site.", ...scentWhy], `Open ${who}'s official app yourself now and change the password. Reject every further approval prompt. Follow the steps below.`, { stayWithMe: true, recoveryKinds: ["code", "password", "mfa_approved"] });
  // AC11 — password entered on a phishing page.
  if (input.enteredPassword) return R("AC11", "Password entered on a suspicious page", "barking", "high", `Someone may now know your ${who} password. Change it before they use it.`, ["A password typed into a fake page goes straight to the attacker.", "They will often trigger a login immediately — expect an approval prompt and deny it.", ...scentWhy], `Open ${who} yourself (official app or typed address) and change the password now. If you reuse it elsewhere, change those too.`, { stayWithMe: true, recoveryKinds: ["password", "code", "mfa_approved"] });
  // AC18 — locked out after an attack.
  if (input.kind === "locked_out") return R("AC18", "Locked out of the account", "barking", "high", `You can't get into your ${who} account. Use the official recovery process — not any link or number that was sent to you.`, ["Being locked out after a suspicious event can mean someone changed the password or recovery details.", "Recovery must go through the provider's own process; scammers offer 'account recovery help' too.", ...scentWhy], OPEN_OFFICIAL[prov.id].replace(/Open/, "Use the official recovery page: open"), { stayWithMe: true, recoveryKinds: ["locked_out", "banking_during_access"] });
  // AC15 / AC04 — fake security alert or password reset with a link off the provider's domain.
  if (suspiciousUrls.length && (sig?.loginRequest || pressure || input.kind === "password_reset" || input.kind === "security_alert" || input.kind === "login_alert")) {
    const reset = input.kind === "password_reset";
    return R(reset ? "AC04" : "AC15", reset ? "Fake password reset" : `Fake ${who} security alert`, "barking", "high", `This ${reset ? "reset" : "alert"} links to ${hostOf(suspiciousUrls[0])} — not ${prov.id === "other" ? "a domain Apollo recognises as official" : `${prov.label}'s own domain`}. ${who === "the service" ? "It" : who} wouldn't send you there.`,
      ["Real security alerts never need you to log in through the link they contain.", pressure ? "It uses pressure (urgency or a threat) — the classic tell." : "The domain doesn't match the organisation it claims to be.", ...scentWhy],
      `Don't tap the link. ${OPEN_OFFICIAL[prov.id]} If you already entered anything, use Stay With Me below.`, { handoff: "web", recoveryKinds: ["password", "code"] });
  }
  if (suspiciousUrls.length && prov.id === "other") return R("AC19", "Alert with an unfamiliar link", "growling", "elevated", "This alert contains a link Apollo can't match to a known service. Check the link before doing anything.", ["Unknown alert + unknown link is how most account phishing starts.", "Nothing bad happens until you tap or type something."], "Check the link with Apollo, then open the service yourself instead of using it.", { handoff: "web" });
  // AC01 / AC02 — unexpected MFA prompt.
  if (input.kind === "mfa_prompt") {
    if (input.userInitiated === true && !input.repeated) return R("AC20", "Login prompt matching your recent action", "ears_up", "low", `The timing matches a login you reported starting, but that does not authenticate this prompt.`, ["Your report explains why a prompt may be expected.", "Check the service name, device and location in the official app before approving."], "Approve only if the prompt appears in the official app and every displayed detail matches the login you just started.");
    const fatigue = !!input.repeated;
    return R(fatigue ? "AC02" : "AC01", fatigue ? "Repeated approval requests (MFA fatigue)" : input.userInitiated === false ? "Login prompt you didn't start" : "Login prompt to verify", input.userInitiated === null && !fatigue ? "growling" : "barking", fatigue || input.userInitiated === false ? "very_high" : "elevated",
      input.userInitiated === null && !fatigue ? "Not sure you started this? Then don't approve it. Deny it and log in yourself to check." : "Don't approve this login. Someone may already know your password.",
      ["If the prompt is genuine, it can mean someone typed the correct password and is waiting for approval; the submitted alert alone cannot prove that.", fatigue ? "Repeated prompts are meant to wear you down until you tap 'approve' by mistake." : "Denying costs you nothing; approving could hand over the account.", ...scentWhy],
      `Use the official app to tap Deny / “It wasn't me”. Then ${OPEN_OFFICIAL[prov.id].charAt(0).toLowerCase()}${OPEN_OFFICIAL[prov.id].slice(1)} ${input.userInitiated === false || fatigue ? "Change the password because an unrequested genuine prompt could mean it is known." : "Review recent activity before deciding whether to change the password."}`, { stayWithMe: fatigue || input.userInitiated === false, recoveryKinds: ["password", "mfa_approved", "code"] });
  }
  // AC14 — recovery email/phone changed unexpectedly.
  if (input.kind === "recovery_changed") {
    if (input.userInitiated === true) return R("AC20", "Recovery change matching your report", "ears_up", "low", "You reported making this change, but the alert itself is not authenticated.", ["Your report makes the change expected, not verified."], OPEN_OFFICIAL[prov.id]);
    return R("AC14", "Recovery email or phone changed", "barking", "very_high", `Someone may be taking over your ${who} account — changing recovery details is how they lock you out.`, ["Recovery details control who can reset the password next.", "Real providers send this alert precisely so you can undo it fast.", ...scentWhy], `${OPEN_OFFICIAL[prov.id]} Revert the recovery change, change the password and sign out all other sessions — in that order.`, { stayWithMe: true, recoveryKinds: ["password", "locked_out"] });
  }
  // AC06 — password was changed / reset without asking.
  if (input.kind === "password_changed") {
    if (input.userInitiated === true) return R("AC20", "Password change matching your report", "ears_up", "low", "You reported making this change, but the submitted alert is still only a claim.", ["Your report makes the timing expected, not the sender verified."], OPEN_OFFICIAL[prov.id]);
    return R("AC06", "Password changed — not by you", input.userInitiated === false ? "barking" : "growling", input.userInitiated === false ? "high" : "elevated", `If you didn't make this change, secure the account through ${who}'s official app or website now.`, ["A password change you didn't make means someone else could already be inside.", "Don't use any link in the alert to 'undo' it — go in through the front door.", ...scentWhy], `${OPEN_OFFICIAL[prov.id]} Use 'Forgot password' there if you can't sign in, then check recovery details and sessions.`, { stayWithMe: input.userInitiated === false, recoveryKinds: ["password", "locked_out"] });
  }
  // AC05 — genuine reset the user requested.
  if (input.kind === "password_reset") {
    if (input.userInitiated === true) return R("AC05", "Password reset matching your request", "ears_up", "low", urls.length ? `You reported requesting a reset. The visible link host matches ${who}'s configured domains, but that does not authenticate the message or make the link safe to use.` : `You reported requesting a reset, but no official destination was independently established from the submitted evidence.`, ["Your report makes a reset expected, not verified.", urls.length ? "A visible domain match is supporting evidence only." : "No link or official destination was available to check."], `Do not use the alert link. ${OPEN_OFFICIAL[prov.id]} Request a fresh reset there.`);
    return R("AC06", "Password reset you didn't ask for", "growling", "elevated", `Someone entered your email or phone into ${who}'s reset form. Nothing changes unless the link or code is used — so don't use it.`, ["A reset you didn't request usually means someone is probing your account.", "Ignoring it is safe; the link expires on its own.", ...scentWhy], `Ignore the link. ${OPEN_OFFICIAL[prov.id]} Check recent activity and make sure two-factor is on.`);
  }
  // AC07 / AC08 — new login alert.
  if (input.kind === "login_alert") {
    if (input.userInitiated === true && !input.unusualLocation) return R("AC20", "Login matching your report", "ears_up", "low", "You reported making this login, but the alert itself was not authenticated.", ["Your report explains the timing; it does not prove the sender or link is genuine."], OPEN_OFFICIAL[prov.id]);
    const unusual = !!input.unusualLocation;
    return R(unusual ? "AC08" : "AC07", unusual ? "Login from an unusual place" : "Login you don't recognise", input.userInitiated === false && (priorPhish || unusual) ? "growling" : "ears_up", input.userInitiated === false ? "elevated" : "low",
      unusual ? "The provider reports activity that doesn't match what you were doing. Locations can be wrong (VPNs, mobile networks) — but review it." : `A login you don't recognise deserves a look. Not every unknown login is an attacker — it can be your own laptop or a new app.`,
      ["Check the provider's recent-activity page for the device and time.", unusual ? "Geography alone isn't proof — but combined with anything else, act." : "If it isn't yours, sign that device out and change the password.", ...scentWhy], `${OPEN_OFFICIAL[prov.id]} Review devices and sessions there.`, { recoveryKinds: ["password"] });
  }
  // AC09 — breach notice.
  if (input.kind === "breach_notice") {
    const pw = /password/i.test(text);
    return R("AC09", "Claimed data breach notice", "ears_up", pw ? "elevated" : "low", pw ? "The submitted notice claims passwords were exposed. Apollo has not independently confirmed that claim." : "The submitted notice claims a data breach. Selecting or receiving this notice does not confirm a breach.", ["Treat the sender and breach claim as unverified until checked independently.", "Breach-themed alerts are also used for phishing.", "Use the separate breach lookup or the service's official app; never log in through the notice."], `${OPEN_OFFICIAL[prov.id]} Check the service's own security notice or use the separate breach lookup below.`, { recoveryKinds: [] });
  }
  // AC16 — genuine security alert (no off-domain link).
  if (input.kind === "security_alert") return R("AC16", "Security alert to verify", "ears_up", "low", `The submitted alert does not contain a clear off-domain link, but Apollo has not authenticated the sender or its claims.`, [urls.length ? "The visible link host matches a configured official domain; that is supporting evidence only." : "No suspicious link was found in the submitted text.", "Attackers copy genuine alerts, so never act through the message itself.", ...scentWhy], `${OPEN_OFFICIAL[prov.id]} Review recent activity and sessions there.`);
  // AC19 — unknown notification with insufficient evidence.
  return R("AC19", "Unfamiliar account notification", "ears_up", "low", "Apollo can't tell much from this alone. Verify through the official service, not the notification.", ["No suspicious links or requests were found in it.", "Unknown isn't the same as dangerous."], OPEN_OFFICIAL[prov.id]);
}
