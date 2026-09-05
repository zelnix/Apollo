// Gate 2 — Text & Messaging rule engine. Runs entirely on-device.
// Extracts security signals from a pasted/shared message and maps them to the six-state model.
// URL reputation and the optional Gemini explanation are layered on afterwards and never override
// a verdict downward from "barking" or upward past what the evidence supports.

import type { ApolloState } from "./types";

export type Scenario = "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08" | "M09" | "M10" | "M11" | "M12" | "M13" | "M14" | "M15";

export interface MessageSignals {
  urls: string[];
  claimedBrand: string | null;
  brandKind: "bank" | "courier" | "government" | "toll" | "telco" | "tech" | "marketplace" | null;
  requestedAction: string | null;
  paymentRequest: boolean;
  smallPayment: boolean;
  codeRequest: boolean;
  urgency: boolean;
  threat: boolean;
  giftCards: boolean;
  crypto: boolean;
  remoteAccess: boolean;
  newNumber: boolean;
  familyClaim: boolean;
  moneyRequest: boolean;
  platformSwitch: boolean;
  guaranteedReturns: boolean;
  jobOffer: boolean;
  advanceFee: boolean;
  fakePayment: boolean;
  extortion: boolean;
  romanceEscalation: boolean;
  identityRequest: boolean;
  loginRequest: boolean;
  unknownSender: boolean;
}

export interface MessageAnalysis {
  state: ApolloState;
  scenario: Scenario;
  scenarioTitle: string;
  verdict: string;
  why: string[];
  recommendation: string;
  signals: MessageSignals;
  signalLabels: string[];
  /** Verify Sender guidance specific to who the message claims to be. */
  verifySender: string;
}

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?)/gi;
const BRANDS: { re: RegExp; name: string; kind: MessageSignals["brandKind"] }[] = [
  { re: /\bcomm(?:onwealth)?\s?bank\b|\bcba\b|\bnetbank\b/i, name: "CommBank", kind: "bank" },
  { re: /\bwestpac\b/i, name: "Westpac", kind: "bank" },
  { re: /\banz\b/i, name: "ANZ", kind: "bank" },
  { re: /\bnab\b|\bnational australia bank\b/i, name: "NAB", kind: "bank" },
  { re: /\bpaypal\b/i, name: "PayPal", kind: "bank" },
  { re: /\bmacquarie\b|\bbendigo bank\b|\bing\b|\bsuncorp\b|\bbank\b/i, name: "your bank", kind: "bank" },
  { re: /\bauspost\b|\baustralia post\b|\bstartrack\b/i, name: "Australia Post", kind: "courier" },
  { re: /\bdhl\b|\bfedex\b|\bups\b|\btoll\b(?=.*(parcel|deliver))|\bcourier\b|\bparcel\b|\bpackage\b|\bdelivery\b/i, name: "a delivery company", kind: "courier" },
  { re: /\blinkt\b|\be-?toll\b|\btoll\s?(road|payment|notice|charge)\b|\bcitylink\b|\beastlink\b/i, name: "a toll operator", kind: "toll" },
  { re: /\bato\b|\btax office\b|\bmygov\b|\bcentrelink\b|\bservices australia\b|\bmedicare\b|\bafp\b|\bpolice\b|\bgovernment\b/i, name: "a government agency", kind: "government" },
  { re: /\btelstra\b|\boptus\b|\bvodafone\b|\bnbn\b/i, name: "your telco", kind: "telco" },
  { re: /\bapple\b|\bmicrosoft\b|\bgoogle\b|\bnetflix\b|\bamazon\b/i, name: "a tech company", kind: "tech" },
  { re: /\bmarketplace\b|\bgumtree\b|\bebay\b|\bbuyer\b|\bseller\b|\bitem\b.*\b(sold|listed)\b/i, name: "a marketplace", kind: "marketplace" },
];

const has = (t: string, re: RegExp) => re.test(t);

export function extractSignals(sender: string, text: string): MessageSignals {
  const t = text.toLowerCase();
  const urls = Array.from(new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")).filter((u) => /\.[a-z]{2,}(\/|$)/i.test(u) && !/^\d+(\.\d+)+$/.test(u))));
  const brand = BRANDS.find((b) => b.re.test(text));
  const paymentRequest = has(t, /\bpay(ment)?\b|\bfee\b|\bowe|\boverdue\b|\binvoice\b|\bbill\b|\btransfer\b|\bdeposit\b/);
  const smallPayment = has(t, /\$\s?[0-9]{1,2}(\.\d{2})?\b(?!\d)/) && !has(t, /\$\s?[0-9]{3,}/);
  const codeRequest = has(t, /\b(six|6|four|4)[- ]?digit\b|\bverification code\b|\bsecurity code\b|\bone[- ]time (code|password)\b|\botp\b|\bcode (that|we|i) (just )?sent\b|\bsend (me )?the code\b|\bread (me|out) the code\b/);
  const urgency = has(t, /\bimmediately\b|\burgent(ly)?\b|\bright now\b|\bwithin (24|48) hours\b|\btoday\b|\bexpires?\b|\bfinal notice\b|\blast chance\b|\bact now\b|\bnow\b/);
  const threat = has(t, /\brestrict(ed)?\b|\bsuspend(ed)?\b|\blocked\b|\bpenalt(y|ies)\b|\bfine\b|\blegal action\b|\barrest\b|\bwarrant\b|\bcancel(led)?\b|\bdebt\b/);
  const giftCards = has(t, /\bgift ?cards?\b|\bitunes\b|\bgoogle play card\b|\bsteam card\b|\bvoucher codes?\b/);
  const crypto = has(t, /\bbitcoin\b|\bbtc\b|\bcrypto\b|\busdt\b|\bethereum\b|\bwallet address\b|\bbinance\b/);
  const remoteAccess = has(t, /\banydesk\b|\bteamviewer\b|\bremote (access|support|desktop)\b|\binstall (this|the|our) (app|software|support)\b|\bdownload (this|the|our) (app|tool|software)\b/);
  const newNumber = has(t, /\bnew (phone|number|mobile)\b|\btemporary number\b|\bthis is my (new|temp)\b|\bsmashed my phone\b|\bbroke(n)? my phone\b|\blost my phone\b|\bold (phone|number)\b/);
  const familyClaim = has(t, /\bhi (mum|mom|dad|nan|nanna|grandma|grandpa|pop)\b|\bit'?s (me|your (son|daughter|grandson|granddaughter))\b|\bmum\b|\bdad\b/);
  const moneyRequest = has(t, /\bcan you (help|send|pay|transfer|lend)\b|\bneed (some |the )?money\b|\bsend (me )?\$?\d|\bpay (a|the|my) bill\b|\btransfer\b|\blend me\b|\burgent(ly)? need\b/);
  const platformSwitch = has(t, /\b(on|via|through|to) (telegram|whatsapp|signal|wechat)\b|\bmessage (our|the) recruiter\b|\bcontact (me|us) on\b/);
  const guaranteedReturns = has(t, /\bguaranteed\b|\b\d{1,3}%\s?(weekly|daily|monthly|returns?|profit)\b|\bpassive income\b|\bdouble your\b|\brisk[- ]free\b|\bselected investors\b/);
  const jobOffer = has(t, /\bjob\b|\brecruit(er|ment)\b|\bwork(ing)? from home\b|\bper day\b|\bper week\b|\bhiring\b|\bposition\b|\bearn \$/);
  const advanceFee = has(t, /\brelease fee\b|\bprocessing fee\b|\bclearance fee\b|\bunlock\b.*\bfee\b/) || (has(t, /\bfee\b/) && has(t, /\bto (access|receive|release) (the |your )?(funds|money|payment)\b/));
  const fakePayment = has(t, /\byou'?ve (been paid|received)\b|\bi'?ve (already )?paid\b|\bpayment (has been )?(sent|made|confirmed)\b|\bawaiting your confirmation\b/);
  const extortion = has(t, /\bhacked\b|\brecorded you\b|\bwebcam\b|\bvideo of you\b|\bsend (it|the video) to (everyone|your contacts|your family)\b|\bexpose\b|\bor i will\b|\bor else\b/);
  const romanceEscalation = has(t, /\b(babe|baby|honey|my love|darling|sweetheart)\b/) && (moneyRequest || crypto || giftCards || has(t, /\btravel\b|\bflight\b|\bvisa\b|\bcustoms\b|\bhospital\b|\bemergency\b/));
  const identityRequest = has(t, /\bverify your identity\b|\bconfirm your (identity|details|information)\b|\bdate of birth\b|\bmedicare number\b|\btax file\b|\btfn\b|\bpassport\b|\bdriver'?s? licen[cs]e\b|\bcard (number|details)\b|\bcvv\b/);
  const loginRequest = has(t, /\blog ?in\b|\bsign ?in\b|\bverify (your )?account\b|\bsecure your account\b|\bupdate your (details|account|password)\b|\bconfirm your account\b|\breactivate\b|\bunlock your account\b/);
  const unknownSender = !sender.trim() || /unknown|private|no caller id/i.test(sender) || /^\+?\d[\d\s()-]{6,}$/.test(sender.trim());

  const requestedAction = codeRequest ? "share a verification code" : giftCards ? "buy gift cards" : remoteAccess ? "install software / allow remote access"
    : advanceFee ? "pay a fee to receive money" : paymentRequest && urls.length ? "pay via a link" : loginRequest ? "log in via a link" : identityRequest ? "share identity details"
    : moneyRequest ? "send money" : crypto ? "send cryptocurrency" : urls.length ? "open a link" : null;

  return { urls, claimedBrand: brand?.name ?? null, brandKind: brand?.kind ?? null, requestedAction, paymentRequest, smallPayment, codeRequest, urgency, threat, giftCards, crypto,
    remoteAccess, newNumber, familyClaim, moneyRequest, platformSwitch, guaranteedReturns, jobOffer, advanceFee, fakePayment, extortion, romanceEscalation, identityRequest, loginRequest, unknownSender };
}

const VERIFY: Record<NonNullable<MessageSignals["brandKind"]> | "family" | "person" | "none", string> = {
  bank: "Open your bank's official app, or call the number printed on the back of your card. Never use a number or link from the message.",
  courier: "Open the courier's official app or type their website address yourself and use your tracking number. Real couriers don't charge small fees by text.",
  government: "Log in to myGov or the agency's official website yourself. Government agencies don't ask for payment or identity details by text link.",
  toll: "Open the toll operator's official app or website yourself and check your account there.",
  telco: "Open your provider's official app or call the number on your bill.",
  tech: "Open the company's official app or website yourself and check for any notices there.",
  marketplace: "Check payment inside the marketplace app or your own bank app. Never follow a courier or payment link a buyer sends you.",
  family: "Call the family member on the number you already have saved. If they don't answer, try another family member before sending anything.",
  person: "Contact the person through a channel you already trust and have used before — not the one in this message.",
  none: "If a message claims to be from someone, contact them using details you already have or find yourself — never from the message.",
};

function scenarioFor(s: MessageSignals): { scenario: Scenario; title: string; state: ApolloState; verdict: string; why: string[]; rec: string; verify: string } {
  const brand = s.claimedBrand ?? "the sender";
  if (s.codeRequest) return { scenario: "M06", title: "Verification code request", state: "barking", verdict: "Someone is asking for a code that is meant only for you.",
    why: ["It asks you to share a verification or security code.", "Codes like this are used to take over accounts.", s.urgency ? "It pushes you to act quickly." : "No legitimate service asks you to read a code back to them."],
    rec: "Don't share that code. Verification codes are meant for you, not for someone contacting you.", verify: VERIFY[s.brandKind ?? "person"] };
  if (s.giftCards) return { scenario: "M10", title: "Gift card scam", state: "barking", verdict: "This is asking you to pay with gift cards — a classic scam.",
    why: ["It asks for gift cards or their codes.", s.claimedBrand ? `It claims to be ${brand}, who never ask for gift cards.` : "No real business, agency or boss asks for payment in gift cards.", s.urgency || s.threat ? "It uses pressure or secrecy." : "Gift card codes can't be traced or refunded."],
    rec: "Don't buy the cards or send any codes. Check with the real person or organisation using details you already have.", verify: VERIFY[s.brandKind ?? "person"] };
  if (s.remoteAccess) return { scenario: "M13", title: "Remote access scam", state: "barking", verdict: "This asks you to install software so someone can 'help' you — don't.",
    why: ["It claims your account or device has a problem you didn't notice.", "It asks you to install an app or allow remote access.", "That software would give a stranger control of your device."],
    rec: "Don't install anything or share your screen. If you're worried about an account, open the official app yourself.", verify: VERIFY[s.brandKind ?? "tech"] };
  if (s.advanceFee || (s.fakePayment && s.paymentRequest && !s.brandKind)) return { scenario: "M12", title: "Fake payment / refund", state: "barking", verdict: "You're being asked to pay to 'receive' money — that's the scam.",
    why: ["It says money is waiting for you.", "It asks for a fee before you can get it.", "Real payments never need a fee to release them."],
    rec: "Don't pay anything. Check your real bank or payment app for the money — if it isn't there, it isn't real.", verify: VERIFY[s.brandKind ?? "marketplace"] };
  if (s.brandKind === "bank" && (s.loginRequest || s.identityRequest || s.urls.length)) return { scenario: "M02", title: "Bank fraud message", state: "barking", verdict: `This message appears to impersonate ${brand}.`,
    why: [`It claims to be ${brand}.`, s.threat || s.urgency ? "It uses fear and urgency about your account or money." : "It asks you to act on your account.", s.urls.length ? "The link does not lead to the bank's official website." : "It asks for details a bank already has."],
    rec: "Don't enter your password or verification code. Open your bank's app yourself to check.", verify: VERIFY.bank };
  if (s.extortion) return { scenario: "M14", title: "Threat / extortion", state: s.crypto || s.paymentRequest ? "barking" : "growling", verdict: "This is an extortion attempt. A claim is not evidence.",
    why: ["It claims to have hacked or recorded you.", s.crypto ? "It demands payment in cryptocurrency." : "It demands payment to stay quiet.", "These are sent in bulk; the claim is almost always false."],
    rec: "Don't pay and don't reply. Apollo sees no evidence your device is compromised from this message alone — change reused passwords if you're worried.", verify: VERIFY.none };
  if (s.familyClaim && (s.newNumber || s.moneyRequest)) return { scenario: "M05", title: "Hi Mum / Hi Dad pattern", state: "ears_up", verdict: "This matches a common family-impersonation scam pattern.",
    why: ["It claims to be a family member on a new or temporary number.", s.moneyRequest ? "It asks for help paying something." : "It sets up a reason for a later money request.", "It uses emotion to hurry you."],
    rec: "Before sending money, contact your family member using the number you already know.", verify: VERIFY.family };
  if (s.brandKind === "courier") return { scenario: "M01", title: "Parcel delivery scam", state: s.paymentRequest || s.urls.length ? "growling" : "ears_up", verdict: "This looks like a parcel-delivery scam.",
    why: ["It claims to be from a delivery company.", s.smallPayment || s.paymentRequest ? "It asks for an unexpected (often small) payment." : "It asks you to act on a parcel you may not be expecting.", s.urls.length ? "The link does not belong to the company being claimed." : "Real couriers don't text payment links."],
    rec: "Don't use the link. Track any parcel through the courier's official app or website.", verify: VERIFY.courier };
  if (s.brandKind === "toll") return { scenario: "M03", title: "Toll / road payment scam", state: "growling", verdict: "This looks like a toll-payment scam.",
    why: ["It claims to be a toll or road operator.", s.threat ? "It threatens penalties to hurry you." : "It asks for a payment you weren't expecting.", s.urls.length ? "Payment is via a link, not the official app." : "Toll operators don't chase payment by text link."],
    rec: "Don't pay via the link. Check your toll account in the official app yourself.", verify: VERIFY.toll };
  if (s.brandKind === "government") return { scenario: "M04", title: "Government / tax impersonation", state: s.identityRequest || s.paymentRequest ? "barking" : "growling", verdict: "This looks like a government impersonation scam.",
    why: ["It claims to be a government agency.", s.paymentRequest ? "It demands a payment." : s.identityRequest ? "It asks for identity details." : "It offers a refund to get you to click.", s.urls.length ? "The link is not an official government address." : "Agencies don't do this by text."],
    rec: "Don't click or reply. Log in to myGov or the agency's website yourself to check for real notices.", verify: VERIFY.government };
  if (s.guaranteedReturns || (s.crypto && (s.moneyRequest || s.paymentRequest))) return { scenario: "M08", title: "Investment / crypto scam", state: "growling", verdict: "This looks like an investment scam.",
    why: ["It offers guaranteed or unrealistic returns.", "It wasn't something you asked for.", s.crypto ? "It involves cryptocurrency, which can't be reversed." : "It rushes you to commit money."],
    rec: "Don't send money. Guaranteed returns don't exist — check any adviser on the ASIC register yourself.", verify: VERIFY.none };
  if (s.romanceEscalation) return { scenario: "M09", title: "Romance scam escalation", state: "growling", verdict: "A relationship message has turned into a request for money.",
    why: ["Affectionate language is paired with a money, gift-card or crypto request.", "Emergencies and travel costs are common pressure stories.", "Apollo is flagging the money request, not the relationship."],
    rec: "Pause before sending anything. Talk it through with someone you trust, and never send money to someone you haven't met.", verify: VERIFY.person };
  if (s.jobOffer && (s.platformSwitch || s.guaranteedReturns || has(text_cache, /\$\s?\d{3,}/))) return { scenario: "M07", title: "Fake job offer", state: s.paymentRequest || s.crypto ? "growling" : "ears_up", verdict: "This matches a fake job-offer pattern.",
    why: ["It promises unusually high, easy earnings.", s.platformSwitch ? "It moves you to another messaging app." : "It's unsolicited.", "These usually end in asking you to pay or 'invest'."],
    rec: "Don't pay any deposit or share ID documents. Apply through the company's official careers page yourself.", verify: VERIFY.none };
  if (s.brandKind === "marketplace" || (s.fakePayment && s.urls.length)) return { scenario: "M11", title: "Marketplace scam", state: "growling", verdict: "This looks like a marketplace payment scam.",
    why: ["It claims payment is done or waiting.", "It sends you to an outside courier or payment link.", "Those links collect card or login details."],
    rec: "Only trust payment you can see in your own bank or the marketplace app. Don't use the link.", verify: VERIFY.marketplace };
  if (s.urls.length && (s.urgency || s.threat || s.loginRequest || s.paymentRequest)) return { scenario: "M04", title: "Suspicious link with pressure", state: "growling", verdict: "This message pushes you to a link with urgency.",
    why: ["It contains a link.", s.threat ? "It threatens a consequence." : "It hurries you.", s.loginRequest ? "It asks you to log in." : "It asks you to act via the link."],
    rec: "Don't tap the link. Check the link with Apollo first, or go to the organisation yourself.", verify: VERIFY[s.brandKind ?? "none"] };
  return { scenario: "M15", title: "Ordinary message", state: "resting", verdict: "Apollo sees nothing suspicious in this message.",
    why: ["No suspicious links.", "No payment, code or identity request.", "No impersonation or threat language."],
    rec: "Nothing to do. If it's from a number you don't know, reply cautiously and never share codes or payment details.", verify: VERIFY.none };
}

let text_cache = "";

export function analyseMessage(sender: string, text: string): MessageAnalysis {
  text_cache = text.toLowerCase();
  const signals = extractSignals(sender, text);
  const r = scenarioFor(signals);
  const labels: string[] = [];
  if (signals.claimedBrand) labels.push(`Claims to be ${signals.claimedBrand}`);
  if (signals.urls.length) labels.push(`${signals.urls.length} link${signals.urls.length > 1 ? "s" : ""}`);
  if (signals.urgency) labels.push("Urgency");
  if (signals.threat) labels.push("Threat / penalty");
  if (signals.paymentRequest) labels.push("Payment request");
  if (signals.codeRequest) labels.push("Code request");
  if (signals.identityRequest) labels.push("Identity request");
  if (signals.loginRequest) labels.push("Login request");
  if (signals.giftCards) labels.push("Gift cards");
  if (signals.crypto) labels.push("Crypto");
  if (signals.remoteAccess) labels.push("Remote access");
  if (signals.newNumber) labels.push("New number");
  if (signals.unknownSender) labels.push("Unknown sender");
  return { state: r.state, scenario: r.scenario, scenarioTitle: r.title, verdict: r.verdict, why: r.why, recommendation: r.rec, signals, signalLabels: labels, verifySender: r.verify };
}

/** Link hand-off: a confirmed-malicious URL raises the message to Guarding (biting) semantics — verified evidence. */
export function escalateForUrl(state: ApolloState, urlVerdict: "clean" | "malicious" | "unknown"): ApolloState {
  if (urlVerdict === "malicious") return "biting";
  return state;
}
