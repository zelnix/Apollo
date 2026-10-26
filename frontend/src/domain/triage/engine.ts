// Higgins Triage — on-device deterministic engine. ZERO Gemini calls.
// Mirrors backend services/triage/engine.py: same catalogue, same rule IDs, same record format.
// Device-sourced evidence (links, messages, calls, apps, files, device, network) is evaluated here,
// closest to where the evidence actually lives.

import {
  CATALOGUE_VERSION, RULES_BY_CATEGORY, RULES_BY_ID, gapIsRecoverable, gapPlainEnglish,
  type CoverageGapRecord, type RetryRecord, type RuleRecord, type RuleResult,
  type TriageInvestigationRecord, type TriageOutcome,
} from "./contract.ts";
import { AVAILABLE_CHECKS, incompletePlain, type IncompleteCheck } from "./completeness.ts";

export type TriageEvidence = Record<string, any>;
type Verdict = { result: RuleResult; evidence: string[]; gap?: string };

const met = (...evidence: string[]): Verdict => ({ result: "met", evidence: evidence.filter(Boolean) });
const unmet = (...evidence: string[]): Verdict => ({ result: "not_met", evidence: evidence.filter(Boolean) });
const na: Verdict = { result: "not_applicable", evidence: [] };
/** Not applicable, with the reason — so the DI shows the rule was considered and why it couldn't run here. */
const naBecause = (reason: string): Verdict => ({ result: "not_applicable", evidence: [reason] });
const gap = (code: string, ...evidence: string[]): Verdict => ({ result: "coverage_gap", evidence: evidence.filter(Boolean), gap: code });

/** Why the browser-observation rules (BITM-01..04) can't execute in a phone app's context. */
export const BROWSER_OBSERVATION_NA = "Not applicable here: this rule needs live observation inside the browser session (page and WebSocket traffic), which this device context cannot provide.";

const sig = (ev: TriageEvidence, name: string): boolean => !!ev.signals?.[name];
const prov = (ev: TriageEvidence, name: string): Record<string, any> => (ev[name] && typeof ev[name] === "object" ? ev[name] : {});

/** Evidence-gated correlation: related event + compatible mechanic + supporting evidence.
 *  Time proximity alone can never satisfy this. */
function correlated(ev: TriageEvidence, ...mechanics: string[]): boolean {
  const corr = prov(ev, "correlation");
  const related = (corr.related as unknown[]) ?? [];
  if (!related.length || !corr.supporting_evidence) return false;
  if (!mechanics.length) return true;
  const present = new Set((corr.mechanics as string[]) ?? []);
  return mechanics.some((m) => present.has(m));
}

const hostsRelated = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

// ── Websites & Links ────────────────────────────────────────────────────────

const LINK: Record<string, (ev: TriageEvidence) => Verdict> = {
  "LINK-01": (ev) => {
    const rep = prov(ev, "reputation");
    if (!Object.keys(rep).length) return na;
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", `reputation lookup did not complete${rep.failure ? ` (${rep.failure})` : ""}`);
    return rep.verdict === "malicious" ? met(`reputation verdict: malicious (${rep.source ?? "threat intelligence"})`) : unmet("reputation verdict: not listed as malicious");
  },
  "LINK-02": (ev) => {
    const red = prov(ev, "redirect");
    if (!red.hops) return na;
    if (["unavailable", "error", "incomplete"].includes(red.status)) {
      // The final destination couldn't be verified. That check is recorded as incomplete (incomplete_checks),
      // never as a completed one — and on its own it is not a coverage gap.
      return unmet(`final destination could not be verified (${red.failure ?? "redirect_failure"})`);
    }
    return red.final_verdict === "malicious"
      ? met(`redirect destination confirmed malicious: ${red.final_url ?? "unknown"}`)
      : unmet(`redirect chain of ${red.hops} hop(s) contains no confirmed malicious destination`);
  },
  "LINK-03": (ev) => (ev.local_level === undefined ? na
    : ev.local_level === "malicious"
      ? met(`local URL engine: malicious via deception-gated rules (${(ev.local_signals ?? []).join(", ")})`)
      : unmet(`local URL engine level: ${ev.local_level}`)),
  "LINK-04": (ev) => (ev.indicator_match === undefined ? na
    : ev.indicator_match ? met("known deterministic threat indicator matched") : unmet("no known threat indicator matched")),
  "LINK-05": (ev) => {
    const signals: string[] = ev.local_signals ?? [];
    if (!signals.includes("brand_lookalike") && !ev.brand_mismatch) return unmet("no brand-lookalike domain observed");
    return ev.credential_interaction ? met("brand-lookalike domain", "credential/login/payment interaction") : unmet("brand-lookalike domain without credential or payment interaction");
  },
  "LINK-06": (ev) => (ev.credentials_in_url === undefined ? na
    : ev.credentials_in_url ? met("credentials embedded in the URL") : unmet("no credentials embedded in the URL")),
  "LINK-07": (ev) => {
    if (!ev.credential_interaction) return unmet("no credential lure observed");
    const signals: string[] = ev.local_signals ?? [];
    return ev.brand_mismatch || signals.includes("brand_in_path")
      ? met("credential lure", "destination unrelated to the brand presented")
      : unmet("credential lure without an unrelated or deceptive destination");
  },
  "LINK-08": (ev) => {
    if (!ev.displayed_host || !ev.actual_host) return na;
    return hostsRelated(ev.displayed_host, ev.actual_host)
      ? unmet("displayed and actual destinations are consistent")
      : met(`displayed link ${ev.displayed_host} resolves to ${ev.actual_host}`);
  },
  "LINK-09": (ev) => {
    const signals: string[] = ev.local_signals ?? [];
    if (!signals.includes("brand_in_path")) return unmet("no brand presented in the link path");
    return ev.credential_interaction
      ? met("brand presented in the link path", "destination belongs to an unrelated domain", "sensitive action requested")
      : unmet("brand in path without a sensitive action");
  },
  "LINK-10": (ev) => {
    const age = prov(ev, "domain_age");
    if (!Object.keys(age).length) return na;
    if (["unavailable", "error", "not_configured"].includes(age.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "domain registration age unavailable");
    return age.newly_registered && ev.credential_interaction
      ? met("domain registered within 30 days", "credential, payment or identity form")
      : unmet("no newly registered domain combined with a sensitive form");
  },
  "LINK-11": (ev) => {
    if (ev.local_level !== "suspicious") return unmet("URL-risk indicators below the suspicious threshold");
    const rep = prov(ev, "reputation");
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "multiple URL-risk indicators, intelligence unavailable");
    return unmet("URL-risk indicators did not resolve to a deterministic threat");
  },
  "LINK-12": (ev) => (!ev.local_level || ev.local_level === "clean" ? unmet("no suspicious URL evidence to correlate")
    : correlated(ev) ? met("suspicious URL evidence correlates with another event") : unmet("no compatible correlated evidence")),
  "QR-01": (ev) => (!ev.qr_payload ? na : ev.qr_is_url ? met("QR payload contains a URL — triaged as a link") : unmet("QR payload is not a URL")),
  "QR-02": (ev) => (!ev.qr_payload ? na : ev.brand_mismatch ? met("QR destination with brand or domain deception") : unmet("QR destination shows no brand deception")),
  "QR-03": (ev) => {
    if (!ev.qr_payload) return na;
    const age = prov(ev, "domain_age");
    const rep = prov(ev, "reputation");
    const unrated = rep.verdict === "unknown" || ["unavailable", "not_configured"].includes(rep.status);
    return ev.credential_interaction && (age.newly_registered || unrated || ["suspicious", "malicious"].includes(ev.local_level))
      ? met("QR destination credential/payment lure", "destination suspicious, unrated or newly registered")
      : unmet("QR destination has no credential lure with a suspicious destination");
  },
  "DATA-01": (ev) => {
    if (!["data", "blob"].includes(ev.scheme)) return na;
    if (!ev.visibility?.browser) return gap("BROWSER_VISIBILITY_UNAVAILABLE", "data:/blob: content could not be observed");
    return ev.credential_interaction && ev.brand_mismatch
      ? met("data:/blob: credential collection", "deceptive brand context")
      : unmet("data:/blob: scheme without credential collection in a deceptive context");
  },
  "BITM-05": (ev) => {
    const rep = prov(ev, "reputation");
    if (!Object.keys(rep).length) return na;
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "phishing-infrastructure intelligence unavailable");
    const types = (rep.threat_types ?? []).map((t: string) => String(t).toLowerCase());
    return rep.verdict === "malicious" && types.includes("phishing")
      ? met("destination matches active phishing/AiTM infrastructure")
      : unmet("destination does not match known AiTM infrastructure");
  },
};

for (const id of ["BITM-01", "BITM-02", "BITM-03", "BITM-04"]) {
  LINK[id] = (ev) => {
    // Without browser/WebSocket observation these rules cannot execute at all in this context, so they are
    // NOT APPLICABLE (reason recorded) — different from a check that should have run but failed.
    if (!ev.visibility?.browser || !ev.visibility?.websocket) return naBecause(BROWSER_OBSERVATION_NA);
    if (!ev.credential_interaction && !ev.code_interaction) return unmet("no sensitive authentication interaction observed");
    const relay = !!ev.realtime_relay;
    const inconsistent = !!(ev.auth_origin_unrelated || ev.brand_mismatch);
    const deception = !!(ev.deception_evidence || ["suspicious", "malicious"].includes(ev.local_level));
    if (id === "BITM-03") {
      return relay && inconsistent && correlated(ev)
        ? met("correlated source", "unrelated authentication origin", "observed relay")
        : unmet("no correlated relay sequence");
    }
    return relay && inconsistent && (deception || id === "BITM-04")
      ? met("sensitive authentication interaction", "unrelated authentication origin", "observed real-time relay")
      : unmet("relay behaviour and destination inconsistency not both observed");
  };
}

// ── Messages ────────────────────────────────────────────────────────────────

const flag = (name: string, label: string, needs: string[] = []) => (ev: TriageEvidence): Verdict => {
  if (!sig(ev, name)) return unmet(`no ${label} observed`);
  if (needs.length && !needs.some((extra) => sig(ev, extra))) return unmet(`${label} without a supporting mechanic`);
  return met(label);
};

/** Spec shape: trigger + consequential action + ANOTHER deterministic anomaly. */
const combination = (trigger: string, label: string, consequential: string[], anomalies: string[]) =>
  (ev: TriageEvidence): Verdict => {
    if (!sig(ev, trigger)) return unmet(`no ${label} observed`);
    if (!consequential.some((name) => sig(ev, name))) return unmet(`${trigger} without a consequential action`);
    const extra = anomalies.filter((name) => sig(ev, name)
      || (name === "brand_mismatch" && !!ev.brand_mismatch)
      || (name === "link_threat" && ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED"));
    if (!extra.length) return unmet(`${trigger} with a consequential action but no supporting anomaly`);
    return met(label, `supporting anomaly: ${extra[0]}`);
  };

const MESSAGE: Record<string, (ev: TriageEvidence) => Verdict> = {
  "MSG-01": flag("code_request", "OTP/MFA/security code request"),
  "MSG-02": flag("login_request", "password, PIN or login credential request"),
  "MSG-03": flag("identity_request", "banking or card credential request"),
  "MSG-04": flag("safe_account", "transfer to a safe/protected account"),
  "MSG-05": flag("gift_cards", "gift-card payment request"),
  "MSG-06": flag("remote_access", "remote access or screen sharing request"),
  "MSG-07": flag("install_request", "app or software installation request"),
  "MSG-08": (ev) => {
    if (ev.signals?.brand_kind !== "government") return unmet("no authority impersonation observed");
    return ["payment_request", "identity_request", "code_request", "threat"].some((s) => sig(ev, s))
      ? met("government/authority impersonation", "payment, credential, code or threat")
      : unmet("authority claim without a consequential demand");
  },
  "MSG-09": flag("extortion", "extortion"),
  "MSG-10": flag("advance_fee", "advance-fee mechanics"),
  "MSG-11": flag("fake_payment", "fake-payment mechanics"),
  "MSG-12": (ev) => (ev.link_outcome == null ? na
    : ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED" ? met("an embedded link reached a deterministic Possible Threat") : unmet(`embedded link triage: ${ev.link_outcome}`)),
  "MSG-13": (ev) => {
    if (!sig(ev, "family_claim") && !sig(ev, "new_number")) return unmet("no family or new-number impersonation");
    return ["money_request", "code_request", "identity_request"].some((s) => sig(ev, s))
      ? met("family/new-number impersonation", "money, credential or code request")
      : unmet("family claim without a money, credential or code request");
  },
  "MSG-14": (ev) => {
    if (!ev.signals?.claimed_brand) return unmet("no brand claimed");
    const consequential = ["payment_request", "login_request", "identity_request", "code_request"].some((s) => sig(ev, s));
    return consequential && (ev.brand_mismatch || ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED")
      ? met("brand impersonation", "consequential action", "inconsistent contact or destination")
      : unmet("brand claim without both a consequential action and an inconsistent destination");
  },
  "MSG-15": flag("guaranteed_returns", "guaranteed-return approach", ["payment_request", "crypto", "money_request"]),
  "MSG-16": flag("job_offer", "job offer with payment or credential harvesting", ["payment_request", "crypto", "gift_cards", "identity_request"]),
  "MSG-17": flag("romance_escalation", "romance interaction with a financial request"),
  "MSG-18": flag("identity_request", "sensitive identity request with impersonation", ["claimed_brand", "unknown_sender"]),
  "MSG-19": flag("platform_switch", "platform switching with another scam mechanic", ["payment_request", "crypto", "job_offer", "guaranteed_returns", "identity_request"]),
  "MSG-20": combination("threat", "urgency or threat with a consequential action and a supporting anomaly",
    ["payment_request", "login_request", "identity_request", "code_request", "money_request"],
    ["unknown_sender", "new_number", "platform_switch", "brand_mismatch", "link_threat"]),
  "MSG-21": combination("unknown_sender", "uncertain identity with a consequential action and another anomaly",
    ["payment_request", "login_request", "identity_request", "code_request", "money_request"],
    ["urgency", "threat", "new_number", "platform_switch", "brand_mismatch", "link_threat"]),
  "MSG-22": (ev) => {
    const moderate = ["urgency", "threat", "payment_request", "unknown_sender", "platform_switch", "job_offer",
      "guaranteed_returns", "crypto", "new_number", "login_request"].filter((name) => sig(ev, name));
    const consequential = ["payment_request", "login_request", "crypto", "identity_request"].some((s) => sig(ev, s));
    return moderate.length >= 3 && consequential
      ? met(`coherent scam pattern: ${moderate.join(", ")}`)
      : unmet(`${moderate.length} moderate indicator(s) — no coherent scam pattern`);
  },
  "PAY-01": (ev) => (!sig(ev, "instant_payment") ? unmet("no instant-payment request observed")
    : ev.signals?.claimed_brand || sig(ev, "family_claim")
      ? met("instant-payment request", "authority, family or business impersonation")
      : unmet("instant-payment use alone is not a threat")),
  "PAY-02": (ev) => (!sig(ev, "instant_payment") ? unmet("no instant-payment request observed")
    : (sig(ev, "urgency") || sig(ev, "threat")) && sig(ev, "unknown_sender")
      ? met("instant-payment request", "urgency or threat", "sender anomaly")
      : unmet("instant-payment use alone is not a threat")),
  "PAY-03": (ev) => (!sig(ev, "instant_payment") ? unmet("no instant-payment request observed")
    : sig(ev, "payment_change")
      ? met("unexpected change of payment destination", "immediate-payment request")
      : unmet("instant-payment use alone is not a threat")),
  "FWD-01": (ev) => {
    if (!sig(ev, "forwarding_code")) return unmet("no forwarding service code instruction");
    return ev.signals?.claimed_brand || sig(ev, "threat") || sig(ev, "login_request")
      ? met("instruction to enter a call/SMS forwarding code", "suspicious account, security or authority context")
      : unmet("service code without a relevant suspicious context");
  },
  "FWD-02": (ev) => (sig(ev, "forwarding_intent") ? met("instruction designed to redirect calls, messages or security codes") : unmet("no instruction to redirect calls, messages or codes")),
  "CB-01": (ev) => (!sig(ev, "callback_request") ? unmet("no supplied callback number")
    : sig(ev, "alleged_charge") ? met("claimed charge or account problem", "callback number supplied by the message") : unmet("callback lure conditions not met")),
  "CB-02": (ev) => (!sig(ev, "callback_request") ? unmet("no supplied callback number")
    : sig(ev, "urgency") || sig(ev, "threat") ? met("urgent cancellation, refund or security lure", "suspicious callback number") : unmet("callback lure conditions not met")),
  "CB-03": (ev) => {
    if (!sig(ev, "callback_request")) return unmet("no supplied callback number");
    // Without a claimed charge or brand this rule can't be met whatever the number's reputation says,
    // so a failed lookup can't change it — it is not a coverage gap.
    if (!sig(ev, "alleged_charge") && !ev.signals?.claimed_brand) return unmet("callback number without a claimed charge or brand impersonation");
    const rep = prov(ev, "phone_reputation");
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "callback number reputation unavailable");
    return rep.verdict === "clean"
      ? met("clean callback reputation does not override impersonation evidence")
      : unmet("callback lure conditions not met");
  },
};

// ── Calls ───────────────────────────────────────────────────────────────────

const ask = (name: string, label: string) => (ev: TriageEvidence): Verdict =>
  (new Set<string>(ev.asks ?? []).has(name) ? met(`caller asked: ${label}`) : unmet(`caller did not ask: ${label}`));

const CALL: Record<string, (ev: TriageEvidence) => Verdict> = {
  "CALL-01": ask("code", "a verification or security code"),
  "CALL-02": ask("password", "a password or PIN"),
  "CALL-03": ask("bankdetails", "banking or card credentials"),
  "CALL-04": (ev) => {
    if (!new Set<string>(ev.asks ?? []).has("transfer")) return unmet("no transfer requested");
    return ev.claim === "bank" || ev.safe_account ? met("caller requested a transfer to a safe/protected account") : unmet("transfer requested without a safe-account framing");
  },
  "CALL-05": ask("giftcards", "gift-card payment"),
  "CALL-06": ask("crypto", "a cryptocurrency transfer"),
  "CALL-07": (ev) => {
    const asks = new Set<string>(ev.asks ?? []);
    return asks.has("remote") || asks.has("screen") ? met("caller asked for remote access or screen sharing") : unmet("caller did not ask for remote access or screen sharing");
  },
  "CALL-08": ask("install", "software or app installation"),
  "CALL-09": ask("forwarding", "a call/SMS forwarding instruction"),
  "CALL-10": (ev) => {
    if (ev.claim !== "government") return unmet("caller did not claim government authority");
    const asks = new Set<string>(ev.asks ?? []);
    return ["transfer", "crypto", "bankdetails", "giftcards"].some((a) => asks.has(a)) || ev.threat
      ? met("claimed authority", "payment demand or threat") : unmet("authority claim without a payment demand");
  },
  "CALL-11": (ev) => {
    if (ev.claim !== "techsupport") return unmet("caller did not claim technical support");
    const asks = new Set<string>(ev.asks ?? []);
    return ["remote", "screen", "install"].some((a) => asks.has(a))
      ? met("unsolicited technical support", "device access requested") : unmet("tech-support claim without a device-access request");
  },
  "CALL-12": (ev) => {
    if (ev.claim !== "investment") return unmet("no investment solicitation");
    const asks = new Set<string>(ev.asks ?? []);
    return ["transfer", "crypto", "bankdetails"].some((a) => asks.has(a))
      ? met("investment solicitation", "consequential financial action") : unmet("investment solicitation without a financial action");
  },
  "CALL-13": (ev) => {
    if (!ev.claim || ev.claim === "unknown") return unmet("caller identity not claimed");
    const asks = new Set<string>(ev.asks ?? []);
    const sensitive = ["transfer", "code", "password", "bankdetails", "remote", "screen"].some((a) => asks.has(a));
    return sensitive && (ev.threat || ev.dont_hangup)
      ? met("claimed authority", "sensitive action", "suspicious behaviour")
      : unmet("claimed authority without both a sensitive action and suspicious behaviour");
  },
  "CALL-14": ask("refund", "an unexpected refund or payment change"),
  "CALL-15": (ev) => {
    const rep = prov(ev, "phone_reputation");
    if (!Object.keys(rep).length) return na;
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "caller reputation unavailable");
    const asks = new Set<string>(ev.asks ?? []);
    const riskyAsk = [...asks].some((a) => a !== "nothing" && a !== "other");
    return ["malicious", "high_risk"].includes(rep.verdict) && riskyAsk
      ? met("negative caller reputation", "matching scam behaviour")
      : unmet("reputation evidence without matching scam behaviour");
  },
  "CALL-16": (ev) => (correlated(ev, "remote_access", "permission_change", "device_change")
    ? met("call followed by remote-access/permission/device change") : unmet("no coherent post-call sequence")),
};

// ── Apps ────────────────────────────────────────────────────────────────────

const capability = (name: string, label: string) => (ev: TriageEvidence): Verdict => {
  const caps: string[] = ev.app_capabilities ?? [];
  if (!caps.length) return na;
  if (!caps.includes(name)) return unmet(`no unexpected ${label}`);
  const suspicious = ["sideload", "unknown", "message", "link"].includes(ev.provenance) || correlated(ev);
  return suspicious ? met(`unexpected ${label}`, "suspicious provenance or Threat Scent") : unmet(`${label} with expected provenance`);
};

const APP: Record<string, (ev: TriageEvidence) => Verdict> = {
  "APP-01": (ev) => ((ev.app_capabilities ?? []).includes("remote_access")
    ? (correlated(ev, "remote_access", "scam_call", "scam_message") ? met("remote-access app follows a suspicious call, message or site") : unmet("remote-access app without a correlated suspicious source"))
    : unmet("no remote-access capability observed")),
  "APP-02": (ev) => (ev.provenance === "sideload"
    ? (correlated(ev, "scam_message", "deceptive_link") ? met("sideload follows a suspicious link or message") : unmet("sideload without a correlated suspicious source"))
    : unmet("app was not sideloaded")),
  "APP-03": (ev) => (ev.provenance === "sideload" && ev.brand_mismatch ? met("sideloaded app impersonates a known brand") : unmet("no sideloaded brand impersonation")),
  "APP-04": (ev) => (ev.provenance === "sideload" && ["update", "security", "system"].includes(ev.claimed_role)
    ? met("sideloaded app impersonates update/security/system software") : unmet("no update or system-software impersonation")),
  "APP-05": (ev) => {
    const rep = prov(ev, "reputation");
    if (!(ev.destinations ?? []).length) return na;
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "destination reputation unavailable");
    return rep.verdict === "malicious" ? met("app communicates with a confirmed malicious destination") : unmet("no malicious destination observed");
  },
  "APP-06": capability("accessibility", "accessibility access"),
  "APP-07": capability("device_admin", "device-admin access"),
  "APP-08": capability("screen_capture", "screen sharing"),
  "APP-09": capability("install_packages", "install-app capability"),
  "APP-10": (ev) => {
    const caps: string[] = ev.app_capabilities ?? [];
    const highImpact = caps.filter((c) => ["accessibility", "device_admin", "screen_capture", "install_packages", "sms", "notification_listener"].includes(c));
    return highImpact.length >= 2 && ["sideload", "unknown", "message", "link"].includes(ev.provenance)
      ? met(`multiple high-impact permissions (${highImpact.join(", ")})`, "suspicious installation provenance")
      : unmet("no high-impact permission cluster with suspicious provenance");
  },
  "APP-11": (ev) => (correlated(ev, "permission_change", "malicious_destination")
    ? met("install → permission change → suspicious network activity") : unmet("no coherent install sequence")),
  "PWA-01": (ev) => {
    if (!ev.pwa_origin) return na;
    if (!ev.visibility?.browser) return gap("BROWSER_VISIBILITY_UNAVAILABLE", "PWA origin is not observable on this platform");
    const rep = prov(ev, "reputation");
    return rep.verdict === "malicious" || ev.brand_mismatch ? met("PWA installed from a deceptive or malicious site") : unmet("PWA origin raised no deterministic threat");
  },
  "PWA-02": (ev) => {
    if (!ev.pwa_origin) return na;
    if (!ev.visibility?.browser) return gap("BROWSER_VISIBILITY_UNAVAILABLE", "PWA origin is not observable on this platform");
    const age = prov(ev, "domain_age");
    return (age.newly_registered || prov(ev, "reputation").verdict === "unknown") && ev.brand_mismatch && ev.credential_interaction
      ? met("newly registered or unrated PWA origin", "brand impersonation", "login/payment interaction")
      : unmet("PWA installation alone is not a threat");
  },
  "PWA-03": (ev) => {
    if (!ev.pwa_origin) return na;
    if (!ev.visibility?.browser) return gap("BROWSER_VISIBILITY_UNAVAILABLE", "PWA origin is not observable on this platform");
    return correlated(ev, "scam_message", "deceptive_link") ? met("PWA installation follows a correlated scam message or link") : unmet("PWA installation alone is not a threat");
  },
};

// ── Files ───────────────────────────────────────────────────────────────────

const RISKY_EXT = new Set([".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".js", ".vbs", ".wsf", ".msi",
  ".dll", ".hta", ".ps1", ".reg", ".lnk", ".iso", ".img", ".cab", ".jar", ".apk"]);
const MACRO_EXT = new Set([".docm", ".xlsm", ".pptm", ".dotm", ".xlam"]);
const extOf = (ev: TriageEvidence): string => {
  const name = String(ev.filename ?? "").toLowerCase();
  return name.includes(".") ? `.${name.split(".").pop()}` : "";
};

const disguised = (ev: TriageEvidence): Verdict => {
  if (!ev.actual_type) return ev.inspection === "unsupported" ? gap("UNSUPPORTED_FILE_TYPE", "file content type could not be determined") : na;
  return ev.declared_type && ev.declared_type !== ev.actual_type && ["executable", "script"].includes(ev.actual_type)
    ? met(`file presented as ${ev.declared_type} but is actually ${ev.actual_type}`)
    : unmet("file type presentation is consistent");
};

const archive = (kind: string) => (ev: TriageEvidence): Verdict => {
  const data = prov(ev, "archive");
  if (!Object.keys(data).length) return na;
  const entries: string[] = data.entries ?? [];
  if (data.encrypted && !entries.length) {
    if (kind === "entries" || kind === "traversal") return gap("ENCRYPTED_CONTENT", "archive contents are encrypted and could not be inspected");
    if (kind === "unreadable") {
      return ev.suspicious_source || correlated(ev)
        ? met("password-protected archive", "suspicious sender or lure", "contents not inspectable")
        : gap("ENCRYPTED_CONTENT", "archive contents are encrypted and could not be inspected");
    }
    return unmet("archive contents not available to evaluate");
  }
  const dangerous = entries.filter((e) => RISKY_EXT.has(`.${e.toLowerCase().split(".").pop()}`));
  const traversal = entries.filter((e) => e.startsWith("/") || e.includes("..") || e.includes("\u202e"));
  if (kind === "entries") return dangerous.length ? met(`archive contains dangerous content: ${dangerous.slice(0, 3).join(", ")}`) : unmet("archive contains no executable or script");
  if (kind === "traversal") return traversal.length ? met(`archive contains path traversal or deceptive filenames: ${traversal.slice(0, 3).join(", ")}`) : unmet("archive filenames are ordinary");
  if (data.encrypted && dangerous.length) {
    if (kind === "password_in_message" && data.password_source === "originating_message") return met("password-protected archive", "password supplied in the originating message", "dangerous payload");
    if (kind === "password_correlated" && correlated(ev)) return met("password-protected archive", "password correlated to the same case", "dangerous payload");
  }
  return unmet("password protection alone is not a threat");
};

const FILE: Record<string, (ev: TriageEvidence) => Verdict> = {
  "FILE-01": disguised,
  "FILE-02": (ev) => {
    const parts = String(ev.filename ?? "").toLowerCase().split(".");
    return parts.length >= 3 && RISKY_EXT.has(`.${parts[parts.length - 1]}`) &&
      ["pdf", "doc", "docx", "jpg", "jpeg", "png", "txt", "xls", "xlsx"].includes(parts[parts.length - 2])
      ? met(`dangerous double extension: ${ev.filename}`) : unmet("no dangerous double extension");
  },
  "FILE-03": (ev) => (["\u202e", "\u202b", "\u202a"].some((ch) => String(ev.filename ?? "").includes(ch))
    ? met("right-to-left override character in the filename") : unmet("no right-to-left filename deception")),
  "FILE-04": (ev) => (!RISKY_EXT.has(extOf(ev)) ? unmet("file is not an executable or script")
    : ev.expected ? unmet("executable was expected by the person") : met(`unexpected executable/script (${extOf(ev)})`)),
  "FILE-05": (ev) => (extOf(ev) !== ".apk" ? unmet("file is not an APK")
    : ["sideload", "unknown", "message", "link"].includes(ev.provenance) || !ev.expected ? met("suspicious APK provenance") : unmet("APK with expected provenance")),
  "FILE-06": (ev) => (extOf(ev) === ".apk" && ev.brand_mismatch ? met("APK impersonates a brand or update") : unmet("no APK brand deception")),
  "FILE-07": (ev) => ([".mobileconfig", ".plist"].includes(extOf(ev)) ? met(`a configuration profile (${extOf(ev)})`) : unmet("file is not a configuration profile")),
  "FILE-08": (ev) => ([".cer", ".crt", ".pem", ".p12", ".pfx"].includes(extOf(ev)) ? met(`a trust certificate (${extOf(ev)})`) : unmet("file is not a trust certificate")),
  "FILE-09": (ev) => (!MACRO_EXT.has(extOf(ev)) ? unmet("file is not a macro-enabled document")
    : ev.expected && ["store", "expected"].includes(ev.provenance) ? unmet("macro document with expected provenance") : met(`a macro-enabled document (${extOf(ev)})`)),
  "FILE-10": (ev) => (ev.embedded_urls == null ? na
    : ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED" ? met("embedded malicious or deceptive URL") : unmet("embedded URLs raised no deterministic threat")),
  "FILE-11": (ev) => {
    const data = prov(ev, "pdf_features");
    if (!Object.keys(data).length) return na;
    if (["unavailable", "error", "unsupported"].includes(data.status)) return gap("UNSUPPORTED_FILE_TYPE", "PDF active content could not be inspected");
    return (data.dangerous ?? []).length ? met(`PDF active content: ${(data.dangerous ?? []).slice(0, 4).join(", ")}`) : unmet("PDF contains nothing dangerous");
  },
  "FILE-12": (ev) => {
    const data = prov(ev, "office_features");
    if (!Object.keys(data).length) return na;
    if (["unavailable", "error", "unsupported"].includes(data.status)) return gap("UNSUPPORTED_FILE_TYPE", "Office content could not be inspected");
    return (data.dangerous ?? []).length ? met(`Office macro/template content: ${(data.dangerous ?? []).slice(0, 4).join(", ")}`) : unmet("Office document contains nothing dangerous");
  },
  "FILE-13": archive("entries"),
  "FILE-14": archive("traversal"),
  "FILE-15": disguised,
  "ARCH-01": archive("password_in_message"),
  "ARCH-02": archive("password_correlated"),
  "ARCH-03": archive("unreadable"),
  "FQR-01": (ev) => (!ev.qr_payload ? na
    : ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED" ? met("QR code detected — destination triaged as a link") : unmet("QR destination raised no deterministic threat")),
};

// ── Device & Internet ───────────────────────────────────────────────────────

const platformSignal = (key: string, label: string, gapCode: string, decide: (ev: TriageEvidence) => Verdict) =>
  (ev: TriageEvidence): Verdict => {
    if (ev.visibility && ev.visibility[key] === false) return gap(gapCode, `${label} is not available to ApolloSG on this device`);
    return decide(ev);
  };

const DEVICE: Record<string, (ev: TriageEvidence) => Verdict> = {
  "DEV-01": platformSignal("os_security", "the OS security report", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.os_threat ? met("trusted OS security facility reports malware or a threat") : unmet("OS security reported no threat"))),
  "DEV-02": (ev) => (ev.remote_access_active
    ? (correlated(ev, "scam_call", "scam_message", "remote_access") ? met("remote-access activation correlates with suspicious activity") : unmet("remote access active without correlated suspicious activity"))
    : unmet("no remote-access activation observed")),
  "DEV-03": (ev) => (ev.management_change
    ? (correlated(ev) ? met("unexpected management/profile change", "correlated suspicious activity") : unmet("management change without correlated suspicious activity"))
    : unmet("no unexpected management or profile change")),
  "DEV-04": (ev) => (ev.certificate_change
    ? (correlated(ev) ? met("unexpected trusted certificate", "correlated suspicious activity") : unmet("certificate change without correlated suspicious activity"))
    : unmet("no unexpected trusted certificate")),
  "DEV-05": (ev) => ((ev.app_capabilities ?? []).includes("accessibility") && ev.new_app
    ? (correlated(ev) ? met("new app with unexpected accessibility", "relevant Threat Scent") : unmet("accessibility grant without relevant Threat Scent"))
    : unmet("no new app with unexpected accessibility")),
  "DEV-06": (ev) => ((ev.app_capabilities ?? []).includes("device_admin") && ev.new_app
    ? (correlated(ev) ? met("new app with unexpected device-admin", "relevant Threat Scent") : unmet("device-admin grant without relevant Threat Scent"))
    : unmet("no new app with unexpected device-admin")),
  "DEV-07": (ev) => (ev.vpn_change && !ev.vpn_trusted
    ? (correlated(ev) ? met("suspicious VPN change", "correlated suspicious app or scam activity") : unmet("VPN change without correlated suspicious activity"))
    : unmet("no suspicious VPN installation or change")),
  "DEV-08": (ev) => ((ev.device_changes ?? []).length >= 2 ? met(`multiple device-security changes: ${(ev.device_changes ?? []).slice(0, 4).join(", ")}`) : unmet("no coherent high-risk sequence of device changes")),
  "DEV-09": (ev) => (ev.integrity === "compromised"
    ? (correlated(ev) ? met("system-integrity indicators", "supporting compromise evidence") : unmet("integrity indicators without supporting compromise evidence"))
    : unmet("no system-integrity indicators")),
  "DNS-01": platformSignal("dns", "private DNS state", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.dns_change && correlated(ev) ? met("unexpected DNS/DoH change", "correlated suspicious activity") : unmet("custom DNS alone is not a threat"))),
  "DNS-02": platformSignal("dns", "private DNS state", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.dns_server && prov(ev, "reputation").verdict === "malicious" ? met("DNS server matches malicious infrastructure") : unmet("DNS server not listed as malicious"))),
  "DNS-03": platformSignal("dns", "private DNS state", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.dns_change && correlated(ev, "app_install", "permission_change") ? met("DNS change", "preceding suspicious app or permission event") : unmet("custom DNS alone is not a threat"))),
  "PUSH-01": platformSignal("push", "browser notification origin", "BROWSER_VISIBILITY_UNAVAILABLE",
    (ev) => (ev.push_origin && ev.credential_interaction && ev.brand_mismatch ? met("deceptive web-push security/financial warning", "action lure") : unmet("notification permission alone is not a threat"))),
  "PUSH-02": platformSignal("push", "browser notification origin", "BROWSER_VISIBILITY_UNAVAILABLE",
    (ev) => (ev.push_origin && ev.brand_mismatch ? met("notification impersonates a known service", "inconsistent destination") : unmet("notification permission alone is not a threat"))),
  "PUSH-03": platformSignal("push", "browser notification origin", "BROWSER_VISIBILITY_UNAVAILABLE",
    (ev) => (ev.push_origin && ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED" ? met("web-push notification leads to a malicious or deceptive URL") : unmet("notification permission alone is not a threat"))),
};

const NETWORK: Record<string, (ev: TriageEvidence) => Verdict> = {
  "NET-01": (ev) => {
    if (!(ev.destinations ?? []).length) return na;
    const rep = prov(ev, "reputation");
    if (["unavailable", "not_configured", "error"].includes(rep.status)) return gap("INTELLIGENCE_PROVIDER_UNAVAILABLE", "destination reputation unavailable");
    return rep.verdict === "malicious" ? met("confirmed malicious destination observed") : unmet("no malicious destination observed");
  },
  "NET-02": (ev) => (!ev.captive_url ? na
    : ev.link_outcome === "POSSIBLE_THREAT_IDENTIFIED" ? met("captive-portal destination reached a link Possible Threat") : unmet("captive portal alone is not a threat")),
  "NET-03": (ev) => (ev.vpn_change && !ev.vpn_trusted
    ? (correlated(ev) ? met("unexpected VPN change", "suspicious app or device activity") : unmet("VPN change without correlated suspicious activity"))
    : unmet("no unexpected VPN change")),
  "NET-04": (ev) => (correlated(ev) ? met("network behaviour correlates with an existing suspicious incident") : unmet("no correlated suspicious incident")),
  "NET-05": (ev) => ((ev.destinations ?? []).length && correlated(ev, "malicious_destination")
    ? met("app/site/device sequence communicates with malicious infrastructure") : unmet("no malicious infrastructure sequence")),
  "TLS-01": platformSignal("tls", "certificate validation detail", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.tls_validation === "failed" && ev.credential_interaction ? met("certificate validation failed during a sensitive interaction") : unmet("public Wi-Fi alone remains neutral"))),
  "TLS-02": platformSignal("tls", "certificate validation detail", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.tls_validation === "untrusted" ? met("unexpected self-signed or untrusted certificate for a sensitive service") : unmet("no untrusted certificate observed"))),
  "TLS-03": platformSignal("tls", "certificate identity", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.tls_identity === "mismatch" ? met("certificate identity does not match the requested domain") : unmet("certificate identity matches"))),
  "TLS-04": platformSignal("tls", "root certificate state", "PLATFORM_CAPABILITY_UNAVAILABLE",
    (ev) => (ev.certificate_change && correlated(ev) ? met("new trusted root certificate", "correlated suspicious network behaviour") : unmet("no new root certificate with correlated behaviour"))),
};

// ── Cross-protection correlation ────────────────────────────────────────────

const CORR_MECHANICS: Record<string, string[]> = {
  "CORR-01": ["remote_access"],
  "CORR-02": ["app_install", "pwa_install"],
  "CORR-03": ["payment_change", "instant_payment"],
  "CORR-04": ["auth_relay"],
  "CORR-05": ["callback"],
  "CORR-06": ["dns_change", "vpn_change", "permission_change"],
  "CORR-07": ["download", "malicious_destination"],
  "CORR-08": ["archive_password"],
  "CORR-09": ["web_push"],
};

const CORRELATION: Record<string, (ev: TriageEvidence) => Verdict> = Object.fromEntries(
  Object.entries(CORR_MECHANICS).map(([id, mechanics]) => [id, (ev: TriageEvidence): Verdict => {
    if (!((prov(ev, "correlation").related as unknown[]) ?? []).length) return na;
    return correlated(ev, ...mechanics) ? met(`correlated sequence: ${RULES_BY_ID[id].title}`) : unmet("no compatible correlated mechanic with supporting evidence");
  }]),
);

const REGISTRY: Record<string, Record<string, (ev: TriageEvidence) => Verdict>> = {
  link: LINK, message: MESSAGE, call: CALL, app: APP, file: FILE, device: DEVICE, network: NETWORK,
  correlation: CORRELATION, email: {}, account: {},
};

const SCOPE: Record<string, string[]> = {
  link: ["link", "correlation"], url: ["link", "correlation"], site: ["link", "correlation"], qr: ["link", "correlation"],
  message: ["message", "link", "correlation"], text: ["message", "link", "correlation"],
  call: ["call", "correlation"], email: ["email", "link", "correlation"], account: ["account", "correlation"],
  file: ["file", "link", "correlation"], app: ["app", "correlation"], device: ["device", "correlation"],
  network: ["network", "correlation"],
};

function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `tri-${Date.now().toString(36)}-${random}`;
}

/** Run every applicable catalogue rule for this evidence. Pure, synchronous, zero Gemini calls. */
export function evaluateTriage(evidence: TriageEvidence, options: { investigationId?: string; retries?: RetryRecord[] } = {}): TriageInvestigationRecord {
  const sourceType = String(evidence.source_type ?? "unknown");
  const categories = SCOPE[sourceType] ?? ["correlation"];
  const records: RuleRecord[] = [];

  for (const category of categories) {
    for (const definition of RULES_BY_CATEGORY[category] ?? []) {
      const predicate = REGISTRY[category]?.[definition.id];
      if (!predicate) {
        records.push({ ruleId: definition.id, title: definition.title, category, applicable: false, checked: false,
          result: "not_applicable", evidence: [], coverageGap: null, detail: "evaluated on the server where this evidence lives" });
        continue;
      }
      let verdict: Verdict;
      try {
        verdict = predicate(evidence);
      } catch (error) {
        verdict = gap("DETERMINISTIC_CHECK_ERROR", error instanceof Error ? error.name : "unknown error");
      }
      records.push({
        ruleId: definition.id, title: definition.title, category,
        applicable: verdict.result !== "not_applicable",
        checked: verdict.result === "met" || verdict.result === "not_met",
        result: verdict.result, evidence: verdict.evidence, coverageGap: verdict.gap ?? null, detail: "",
      });
    }
  }

  const gaps = new Map<string, CoverageGapRecord>();
  for (const record of records) {
    if (record.result === "coverage_gap" && record.coverageGap) {
      const existing = gaps.get(record.coverageGap) ?? { code: record.coverageGap, detail: record.evidence[0] ?? "", recoverable: gapIsRecoverable(record.coverageGap), ruleIds: [] };
      existing.ruleIds.push(record.ruleId);
      if (!existing.detail && record.evidence[0]) existing.detail = record.evidence[0];
      // How the lookup this rule needed failed (timeout, quota_exhausted, …) — from the rule's own evidence.
      existing.failure = existing.failure ?? failureFor(record.ruleId, evidence);
      gaps.set(record.coverageGap, existing);
    }
  }
  const incomplete: IncompleteCheck[] = (Array.isArray(evidence.incomplete_checks) ? evidence.incomplete_checks : [])
    .filter((c: unknown): c is IncompleteCheck => !!c && typeof c === "object" && !!(c as IncompleteCheck).check)
    .map((c: IncompleteCheck) => ({ ...c }));

  const metRules = records.filter((r) => r.result === "met");
  let outcome: TriageOutcome;
  let reason: string;
  if (metRules.length) {
    outcome = "POSSIBLE_THREAT_IDENTIFIED";
    reason = metRules[0].title + (metRules.length > 1 ? ` (+${metRules.length - 1} more deterministic rule(s) met)` : "");
  } else if (gaps.size) {
    outcome = "LIMITED_UNABLE_TO_DETERMINE";
    // Plain English for the person; the codes stay on the record's coverage gaps for the DI tab.
    reason = `ApolloSG couldn't obtain enough evidence to decide. ${[...gaps.keys()].sort().map(gapPlainEnglish).join(" ")}`;
  } else if (evidence.unresolved_concern) {
    outcome = "LIMITED_UNABLE_TO_DETERMINE";
    gaps.set("INSUFFICIENT_EVIDENCE", {
      code: "INSUFFICIENT_EVIDENCE",
      detail: String(evidence.unresolved_concern_detail ?? "Concerning indicators did not satisfy any deterministic threat rule."),
      recoverable: false, ruleIds: [],
    });
    reason = "Concerning indicators did not satisfy a deterministic Possible Threat rule.";
  } else if (incomplete.length) {
    // Never present an incomplete examination as a complete one.
    outcome = "NO_THREAT_IDENTIFIED";
    reason = `${AVAILABLE_CHECKS}. Not completed: ${incomplete.map(incompletePlain).join(" ")}`;
  } else {
    outcome = "NO_THREAT_IDENTIFIED";
    reason = "No deterministic threat rule was met and every applicable check completed.";
  }

  const coverageGaps = [...gaps.values()];
  return {
    investigationId: options.investigationId ?? newId(),
    catalogueVersion: CATALOGUE_VERSION,
    sourceType,
    outcome,
    reason,
    rulesApplicable: records.filter((r) => r.applicable).map((r) => r.ruleId),
    rulesChecked: records.filter((r) => r.checked).map((r) => r.ruleId),
    rulesMet: metRules.map((r) => r.ruleId),
    rules: records,
    coverageGaps,
    incompleteChecks: incomplete,
    coverage: incomplete.length || coverageGaps.length ? "incomplete" : "complete",
    retries: options.retries ?? [],
    correlation: prov(evidence, "correlation"),
    recheckUseful: coverageGaps.some((g) => g.recoverable),
    geminiCalls: 0,
    evaluatedAt: new Date().toISOString(),
  };
}

/** The failure kind recorded on the first evidence item this rule reads (catalogue `evidence`), if any. */
function failureFor(ruleId: string, evidence: TriageEvidence): string | null {
  for (const name of RULES_BY_ID[ruleId]?.evidence ?? []) {
    const value = evidence[name];
    if (value && typeof value === "object" && value.failure) return String(value.failure);
  }
  return null;
}

/** Bounded deterministic retry for TRANSIENT non-AI failures only (initial + 2 retries).
 *  Permanent platform/capability limitations are never retried. */
export async function runWithRetries<T>(check: string, operation: () => Promise<T>,
  options: { attempts?: number; permanent?: boolean } = {}): Promise<{ value: T | null; record: RetryRecord }> {
  if (options.permanent) return { value: null, record: { check, attempts: 0, outcome: "not_retried_permanent" } };
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await operation();
      return { value, record: { check, attempts: attempt, outcome: attempt > 1 ? "recovered" : "succeeded" } };
    } catch {
      if (attempt === attempts) return { value: null, record: { check, attempts, outcome: "failed" } };
    }
  }
  return { value: null, record: { check, attempts, outcome: "failed" } };
}
