// Higgins Luddish L1: plain English with the evidence unchanged. No AI, no network.
// Run: node --test tests/luddish.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compose, luddish, luddishChat, luddishCheckResult, luddishReport, luddishText, MAX_NOTES, PLAIN_WORDS } from "../src/domain/luddish/index.ts";
import { BY_ID, COMPILED, DICTIONARY, lookupTerm, termsIn } from "../src/domain/luddish/dictionary.ts";
import { checkExplanation, differences, findingDetail, inShort } from "../src/domain/luddish/fidelity.ts";
import { PLAIN_SWAPS, rewrite, swap } from "../src/domain/luddish/grammar.ts";
import { KNOWLEDGE, KNOWLEDGE_TEXTS } from "../src/domain/luddish/knowledge.ts";
import { lockEvidence, lockIntact, lockedTexts } from "../src/domain/luddish/lock.ts";
import { lockFromInvestigation, lockFromIssue } from "../src/domain/luddish/lockSources.ts";
import { grade, isHard, readability, TARGET_GRADE } from "../src/domain/luddish/readability.ts";
import { noStronger, STATE_RULES, stateFromCheckStatus, stateFromOutcome, stateFromPatrol, stateFromTone, type StateId } from "../src/domain/luddish/rules.ts";
import type { CheckResultModel } from "../src/domain/checkResult.ts";
import type { Report } from "../src/domain/reportSections.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const CONCERN = lockEvidence({
  state: "concern",
  headline: "This text uses ANZ's name, but its link isn't ANZ's website.",
  findings: [{ text: "The link anz-secure-login.co was registered 3 days ago.", basis: "observed", confidence: "high", by: "TC FlyBy" },
    { text: "The message asks you to pay $250 to 0412 345 678 by 5:00 pm.", basis: "inferred", confidence: "medium", by: "TC FlyBy" }],
  explanation: "Magnum DI was unable to confirm who sent it, but the link indicates an impersonation of ANZ, so you should not enter any details on it.",
  uncertainties: ["Apollo is unable to confirm who actually sent this."],
  actions: ["Do not open anz-secure-login.co and do not enter anything on it."],
  how: "TC FlyBy checked the submitted material using official source checks.",
});

// ── Evidence Lock ──
test("the Evidence Lock is frozen with a fingerprint, and a changed lock is never explained in plain words", () => {
  assert.ok(Object.isFrozen(CONCERN) && Object.isFrozen(CONCERN.findings[0]));
  assert.ok(lockIntact(CONCERN));
  assert.throws(() => { (CONCERN.findings[0] as { text: string }).text = "changed"; }, TypeError);
  const tampered = { ...CONCERN, headline: "Nothing to worry about." };
  assert.equal(lockIntact(tampered), false);
  const ex = compose(tampered);
  assert.equal(ex.fidelity.status, "FAIL");
  assert.ok(ex.fidelity.failures.some((f) => f.code === "LOCK_BROKEN"));
  assert.equal(ex.brief.text, tampered.headline, "nothing is reworded from a broken lock");
});

test("states come only from what Apollo recorded, never guessed and never made stronger", () => {
  assert.equal(stateFromPatrol("barking"), "concern");
  assert.equal(stateFromPatrol("biting"), "blocked");
  assert.equal(stateFromTone("neutral"), "unknown");
  assert.equal(stateFromCheckStatus("not_configured"), "not_checked");
  assert.equal(stateFromOutcome("likely_scam"), "likely_scam");
  assert.equal(stateFromOutcome("something_new"), "unknown", "an unknown value is unknown, not safe");
  assert.equal(stateFromPatrol(undefined), "unknown");
  assert.equal(noStronger("suspicious", "threat"), "suspicious");
  assert.equal(noStronger("concern", "suspicious"), "suspicious");
});

// ── Dictionary and Knowledge ──
test("one concept, one name: Luddish's own wording never uses a word the dictionary avoids", () => {
  const ids = DICTIONARY.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "each term once");
  const own = [...Object.values(STATE_RULES).flatMap((r) => [...r.finding, ...r.means, r.matters, r.limitation, r.action, r.noAction]), ...KNOWLEDGE_TEXTS, ...DICTIONARY.map((t) => t.meaning)]
    .filter((s): s is string => !!s).join(" ");
  for (const t of DICTIONARY) for (const avoid of t.avoid ?? []) assert.doesNotMatch(own, new RegExp(`\\b${avoid}\\b`), `${t.id}: "${avoid}"`);
});

test("the dictionary keeps the server's glossary word for word, and its plain swaps", () => {
  const words = read("../../backend/services/higgins/explain/words.py");
  const glossary = [...words.slice(words.indexOf("GLOSSARY"), words.indexOf("GLOSSARY_TEXTS")).matchAll(/"([A-Z][^"]+\.)"\),?/g)].map((m) => m[1]);
  assert.ok(glossary.length >= 19);
  const meanings = new Set(DICTIONARY.map((t) => t.meaning));
  for (const meaning of glossary) assert.ok(meanings.has(meaning), meaning);
  const swaps = [...words.slice(words.indexOf("PLAIN_SWAPS"), words.indexOf("_SWAP_RE")).matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(PLAIN_SWAPS.slice(0, swaps.length), swaps);
});

test("every knowledge entry says where it comes from, and explains a dictionary term", () => {
  for (const k of KNOWLEDGE) {
    assert.ok(k.source.publisher, k.id);
    assert.ok(k.source.kind === "apollosg" || /^https:\/\/[\w.]+\.gov\.au/.test(k.source.url ?? ""), `${k.id}: an authoritative source is a government site`);
    for (const id of k.terms) assert.ok(BY_ID[id], `${k.id}: ${id}`);
  }
});

test("terms are found as whole words, longest first, and a question names its term", () => {
  assert.deepEqual(termsIn("Google Safe Browsing listed this domain for phishing").map((t) => t.id), ["safe_browsing", "domain", "phishing"]);
  assert.deepEqual(termsIn("Our domainname"), [], "not inside another word");
  assert.equal(lookupTerm("What is phishing?".replace(/^what is /i, ""))?.id, "phishing");
  assert.equal(lookupTerm("DMARC")?.id, "dmarc");
  assert.ok(COMPILED.every((t) => t.re.global));
});

// ── Grammar & Punctuation ──
test("formal words become everyday ones; identifiers, amounts and quotes are never touched", () => {
  assert.equal(rewrite("The message is attempting to obtain your login credentials prior to the deadline; it does not indicate who sent it and the URL https://anz-secure.co/login is malicious."),
    "The message is trying to get your sign-in details before the deadline. It doesn't show who sent it and the web address https://anz-secure.co/login is harmful.");
  assert.equal(rewrite("An SMS message from 0412 345 678 asked you to pay $250 on 2026-06-01."), "A text message from 0412 345 678 asked you to pay $250 on 2026-06-01.", "an → a before the plain words");
  assert.equal(rewrite("It said \"do not reply\" and linked to Do-Not-Reply.com.au."), "It said \"do not reply\" and linked to Do-Not-Reply.com.au.", "quotes and domains held aside");
  assert.equal(swap("Malicious URLs"), "Harmful web addresses", "a capital stays a capital, an acronym's doesn't");
  assert.equal(rewrite("the the link was checked .However, it is not listed"), "The link was checked. But it isn't listed");
  assert.equal(rewrite("Assessed takeover risk: very_high. Claim via myGov."), "Assessed takeover risk: very high. Claim through myGov.", "an internal code reads as words");
});

test("a long sentence is split only where a full stop changes nothing, and never into a fragment", () => {
  const long = "Magnum DI was unable to confirm who sent the message to you today, but the link in it indicates an impersonation of ANZ and its website";
  assert.equal(rewrite(long), "Magnum DI couldn't confirm who sent the message to you today. But the link in it shows an impersonation of ANZ and its website.",
    "the split paragraph ends with a full stop like its first sentence");
  const fragment = "The address appeared on a number of lists that Apollo checks every single day, but not on the official list from Google Safe Browsing.";
  assert.equal(rewrite(fragment), fragment, "\", but not …\" would leave a fragment");
  assert.equal(rewrite("It found no warning signs, only a weak signal that isn't a concern on its own — only use it if you reached it yourself from the official app."),
    "It found no warning signs, only a weak signal that isn't a concern on its own — only use it if you reached it yourself from the official app.", "a dash before a fragment stays");
  assert.equal(rewrite("This uses CommBank's name and its link goes somewhere CommBank doesn't use — don't use the link and go to CommBank directly instead."),
    "This uses CommBank's name and its link goes somewhere CommBank doesn't use. Don't use the link and go to CommBank directly instead.");
  const aside = "TC FlyBy — Apollo's fast, low-cost investigator — can't settle something that could change the answer for you right now.";
  assert.equal(rewrite(aside), aside, "a pair of dashes is an aside, never split");
});

// ── Readability ──
test("the Readability Check measures the Year 7–8 target, with known names and identifiers counted as short words", () => {
  assert.equal(TARGET_GRADE, 8);
  assert.ok(grade("Don't tap the link. Delete the text.") < 4);
  assert.ok(grade("Notwithstanding the aforementioned considerations, comprehensive authentication methodologies necessitate organisational verification procedures.") > 12);
  assert.equal(grade("ApolloSG checked https://www.commbank.com.au/netbank/login.html for you today."), grade("Apollo checked it for you today."));
  assert.equal(grade("Don't open the link or reply to the text."), grade("Do not open the link or reply to the text."), "a contraction reads as its two words");
  assert.equal(readability("Parcel delivery scam").label, true, "a title has no reading grade");
  assert.ok(isHard("This sentence keeps going and going with many words in it so that it is far longer than anyone would want to read in one go."));
  const r = readability("Don't tap the link. Delete the text.");
  assert.ok(r.met && r.hard.length === 0);
});

// ── Evidence Fidelity Check ──
test("the Fidelity Check catches every way a sentence could change the evidence", () => {
  const original = "The link anz-secure-login.co was registered 3 days ago, so it is not ANZ's website.";
  assert.deepEqual(differences(original, "The link anz-secure-login.co was registered 3 days ago, so it isn't ANZ's website."), [], "a contraction says the same");
  assert.ok(differences(original, "The link anz-secure-login.co was registered 3 days ago, so it is ANZ's website.").includes("NEGATION_CHANGED"));
  assert.ok(differences(original, "The link anz-secure-login.co was registered 5 days ago, so it is not ANZ's website.").includes("NUMBER_CHANGED"));
  assert.ok(differences(original, "The link was registered 3 days ago, so it is not ANZ's website.").includes("IDENTIFIER_DROPPED"));
  assert.ok(differences(original, "The link anz-secure-login.co was registered 3 days ago. It is not ANZ's website.").includes("CAUSAL_DROPPED"));
  assert.ok(differences(original, "The link anz-secure-login.co was registered 3 days ago, so it is definitely not ANZ's website.").includes("CERTAINTY_ADDED"));
  assert.ok(differences("It could be a warning sign.", "It could be a dangerous warning sign.").includes("SEVERITY_ESCALATED"));
  assert.ok(differences("It is a warning sign.", "It is probably a warning sign.").includes("SEVERITY_SOFTENED"));
  assert.ok(differences("No threat was found in the checks that completed.", "No threat was found in the checks that completed, so it's safe.").includes("SAFETY_CLAIM_ADDED"));
  assert.ok(differences("Reply \"STOP\" to 0412 345 678.", "Reply \"stop\" to 0412 345 678.").includes("QUOTE_ALTERED"));
  assert.ok(differences("Apollo checked the link.", "Apollo checked the link at evil.example.com.").includes("IDENTIFIER_ADDED"));
  assert.ok(differences("The sender's domain failed its DMARC check.", "The sender passed every check Apollo ran.").includes("MEANING_CHANGED"));
});

test("the whole explanation is checked against its lock: knowledge never becomes a finding, Luddish adds only approved wording", () => {
  const ex = compose(CONCERN);
  assert.equal(ex.fidelity.status, "PASS", JSON.stringify(ex.fidelity.failures));
  const knowledgeAsFinding = { ...ex, findings: [{ ...ex.findings[0], text: `${ex.findings[0].text} ${KNOWLEDGE[0].brief}` }, ex.findings[1]] };
  assert.ok(checkExplanation(CONCERN, knowledgeAsFinding).failures.some((f) => f.code === "KNOWLEDGE_AS_EVIDENCE" || f.code === "MEANING_CHANGED"));
  const strongerState = { ...ex, meaning: [{ ref: "means", text: "It's very likely a scam, though it hasn't been confirmed.", source: "rule" as const, note: null }] };
  assert.ok(checkExplanation(CONCERN, strongerState).failures.some((f) => f.code === "STATE_WORDING"));
  const technical = { ...ex, technical: ex.technical.map((t, i) => i ? t : { ...t, text: rewrite(t.text) + " " }) };
  assert.ok(checkExplanation(CONCERN, technical).failures.some((f) => f.code === "TECHNICAL_ALTERED"));
  const basis = { ...ex, findings: [{ ...ex.findings[0], detail: "Seen directly by Magnum DI · High confidence" }, ex.findings[1]] };
  assert.ok(checkExplanation(CONCERN, basis).failures.some((f) => f.code === "BASIS_CHANGED"));
  const dropped = { ...ex, findings: ex.findings.slice(0, 1), action: [] };
  const codes = checkExplanation(CONCERN, dropped).failures.map((f) => f.code);
  assert.ok(codes.includes("FINDING_DROPPED") && codes.includes("ACTION_DROPPED"));
  const note = { ...ex, explanation: { ...ex.explanation!, note: "Scammers are everywhere." } };
  assert.ok(checkExplanation(CONCERN, note).failures.some((f) => f.code === "NOTE_NOT_APPROVED"));
});

// ── Composer ──
test("the Composer writes Finding → Meaning → Importance → Limitation → Action, each from its own place", () => {
  const ex = compose(CONCERN);
  assert.equal(ex.label, "Concerning");
  assert.equal(ex.brief.text, CONCERN.headline);
  assert.equal(ex.explanation?.text, "Magnum DI couldn't confirm who sent it. But the link shows an impersonation of ANZ, so you shouldn't enter any details on it.");
  assert.deepEqual(ex.findings.map((f) => f.text), CONCERN.findings.map((f) => f.text), "findings already plain stay word for word");
  assert.deepEqual(ex.findings.map((f) => f.detail), ["Seen directly by TC FlyBy · High confidence", "TC FlyBy's reading of the evidence, not seen directly · Medium confidence"]);
  assert.deepEqual(ex.meaning.map((p) => [p.source, p.text]), [["rule", "Something Apollo checked needs your attention before you act on it."]]);
  assert.equal(ex.importance?.source, "rule");
  assert.deepEqual(ex.limitation.map((p) => p.text), ["Apollo can't confirm who actually sent this.", "A concern isn't proof of a scam."]);
  assert.deepEqual(ex.action.map((p) => p.text), ["Don't open anz-secure-login.co and don't enter anything on it."]);
  assert.equal(ex.noAction, null, "there is something to do");
  assert.deepEqual(ex.technical.map((t) => t.text), lockedTexts(CONCERN), "the technical detail is Apollo's own wording, untouched");
  assert.deepEqual(ex.terms.map((t) => t.id), ["impersonation", "registration_record"]);
  assert.ok(ex.knowledge.every((k) => KNOWLEDGE.includes(k)), "background only from the Knowledge Library");
  assert.ok(ex.readability.after <= TARGET_GRADE && ex.readability.after <= ex.readability.before);
  assert.deepEqual(ex.fellBack, []);
});

test("a recorded reason and recorded steps are used, never the state's general wording, and the same case always reads the same", () => {
  const lock = lockEvidence({ state: "suspicious", headline: "Possible concern", reason: "Anything typed into that link goes to whoever runs it.", actions: ["Check it on the bank's own app."] });
  const ex = compose(lock);
  assert.deepEqual([ex.importance?.ref, ex.importance?.source], ["reason", "evidence"]);
  assert.deepEqual(ex.action.map((a) => a.ref), ["action:0"]);
  assert.deepEqual(compose(lock), ex, "deterministic");
});

test("only states with nothing to do say so; who blocked it is named only when Apollo recorded it", () => {
  const safe = compose(lockEvidence({ state: "safe" }));
  assert.equal(safe.brief.source, "rule");
  assert.equal(safe.noAction, "You don't need to do anything about this.");
  assert.deepEqual(safe.action, []);
  assert.equal(compose(lockEvidence({ state: "blocked" })).brief.text, "It was blocked.");
  assert.match(compose(lockEvidence({ state: "blocked", blockedBy: "Apollo's Site Gate" })).brief.text, /Apollo's Site Gate/);
  const limited = compose(lockEvidence({ state: "limited", headline: "Some checks couldn't run." }));
  assert.ok(limited.knowledge.some((k) => k.id === "limited_result"));
  assert.equal(limited.action[0].text, "Treat this with caution.");
  for (const id of Object.keys(STATE_RULES) as StateId[]) {
    const ex = compose(lockEvidence({ state: id }));
    assert.equal(ex.fidelity.status, "PASS", `${id}: ${JSON.stringify(ex.fidelity.failures)}`);
    for (const w of STATE_RULES[id].never) {
      for (const p of [ex.brief, ...ex.meaning, ex.importance, ...ex.limitation, ...ex.action]) {
        if (p) assert.doesNotMatch(p.text, new RegExp(`\\b${w}\\b`, "i"), `${id} says "${w}"`);
      }
    }
  }
});

test("Year 7–8 never outranks the evidence: a sentence too hard to simplify keeps its words, with a plain note beside it", () => {
  const hard = "The sender's domain failed DMARC alignment because the DKIM signature was produced by an unrelated third-party mailing infrastructure provider.";
  const ex = compose(lockEvidence({ state: "suspicious", headline: hard }));
  assert.equal(ex.brief.text, hard, "kept word for word");
  assert.ok(ex.brief.note?.includes(BY_ID.dmarc.meaning), "the jargon in it is explained beside it");
  assert.ok(ex.brief.note!.split(/(?<=\.) /).length <= 3, "at most two terms");
  const noJargon = compose(lockEvidence({ state: "suspicious", headline: "This exceptionally comprehensive communication unexpectedly requested immediate confirmation of personal identification information." }));
  assert.equal(noJargon.brief.text, "This exceptionally comprehensive communication unexpectedly requested immediate confirmation of personal identification information.");
  assert.ok(STATE_RULES.suspicious.means.map(inShort).includes(noJargon.brief.note!), "no jargon to explain: the state's approved \"In short\" line");
  assert.equal(noJargon.fidelity.status, "PASS");
});

test("any part whose plain wording would change the evidence stays in Apollo's words", () => {
  // "malicious" → "harmful" is a plain swap; this sentence quotes the word, so the quote must stay and the swap can't apply.
  const lock = lockEvidence({ state: "concern", findings: [{ text: "Google Safe Browsing labels it \"malicious\" and lists it as malicious." }] });
  const ex = compose(lock);
  assert.equal(ex.findings[0].text, "Google Safe Browsing labels it \"malicious\" and lists it as harmful.");
  assert.equal(ex.fidelity.status, "PASS");
});

// ── Where Higgins speaks ──
const MODEL: CheckResultModel = {
  id: "x", gate: "Link checking", checkType: "Link check", subject: "anz-secure-login.co", tone: "barking", confidence: "High", completedAt: "2026-06-01T00:00:00Z",
  headline: "This link is attempting to obtain your login credentials.",
  higginsSays: "The address anz-secure-login.co does not belong to ANZ. PhishTank lists this address as a known threat. I'd recommend not opening this link.",
  whatToDo: "Do not open https://anz-secure-login.co/login. Report it at https://www.scamwatch.gov.au.",
  items: [{ id: "src:phishtank", name: "PhishTank", status: "concern", finding: "PhishTank listed this address as phishing." },
    { id: "domain:info", name: "Domain registration", status: "unavailable", finding: "Domain registration lookup wasn't available for this address." }],
  evidence: [{ label: "Intel verdict", value: "malicious" }],
};

test("a check result: plain headline, explanation and steps, plain item findings, notes only from the dictionary", () => {
  const plain = luddishCheckResult(MODEL);
  assert.equal(plain.headline, "This link is trying to get your sign-in details.");
  assert.equal(plain.higginsSays, "The address anz-secure-login.co doesn't belong to ANZ. PhishTank lists this address as a known threat. I'd recommend not opening this link.");
  assert.equal(plain.whatToDo, "Don't open https://anz-secure-login.co/login. Report it at https://www.scamwatch.gov.au.");
  assert.equal(plain.items["src:phishtank"], MODEL.items[0].finding);
  assert.ok(plain.notes.length <= MAX_NOTES);
  for (const note of plain.notes) assert.ok(DICTIONARY.some((t) => t.meaning === note) || note.startsWith("In short:"), note);
  assert.equal(plain.explanation.fidelity.status, "PASS");
  assert.equal(luddishCheckResult({ ...MODEL, whatToDo: undefined }).whatToDo, undefined, "no step is invented");
  const screen = read("../src/components/CheckResultScreen.tsx");
  assert.match(screen, /<Text style=\{s\.evidenceValue\} testID=\{`check-result-evidence-\$\{i\}`\}>\{row\.value\}<\/Text>/, "the full investigation details are shown as recorded");
  assert.match(screen, /luddishCheckResult\(result\)/);
});

test("a report: every section in plain words, the severity line and sources untouched, a jargon word explained once", () => {
  const report: Report = {
    answer: ["Concerning. The message is attempting to obtain your bank details."], severity: "How serious: you need to act. See what you can do.",
    found: [{ text: "The sender's domain failed its DMARC check.", detail: "Seen directly by TC FlyBy · High confidence", explain: null },
      { text: "The domain was registered 3 days ago.", detail: null, explain: BY_ID.registration_record.meaning }],
    means: ["You should not reply."], more: [{ title: "Also", paragraphs: ["It does not indicate who sent it."] }],
    uncertain: ["Apollo is unable to confirm the sender."], how: ["TC FlyBy checked the message."], sources: [],
  };
  const out = luddishReport(report);
  assert.deepEqual(out.answer, ["Concerning. The message is trying to get your bank details."]);
  assert.equal(out.severity, report.severity);
  assert.equal(out.found[0].explain, BY_ID.sender_domain.meaning, "the first jargon term not already explained (the longest name wins)");
  assert.equal(out.found[1].explain, BY_ID.registration_record.meaning, "the server's explanation is kept");
  assert.deepEqual(out.means, ["You shouldn't reply."]);
  assert.deepEqual(out.more[0].paragraphs, ["It doesn't show who sent it."]);
  assert.deepEqual(out.uncertain, ["Apollo can't confirm the sender."]);
  assert.match(read("../src/components/report/ReportBody.tsx"), /luddishReport\(given\)/);
});

test("Ask Higgins: answers in plain words with plain notes last; a source's own words and fixed replies are never reworded", () => {
  const issue = lockFromIssue({ gate: "link", issue_summary: "Suspicious link", assessment_state: "growling",
    findings: [{ summary: "The domain is not auspost.com.au.", provenance: "observed", status: "warning" }], uncertainty: [], confirmed_protective_actions: [], user_reported_actions: [] });
  assert.equal(issue.state, "suspicious");
  assert.equal(compose(issue).findings[0].detail, findingDetail(issue.findings[0]));
  const answer = luddishChat("What Magnum DI couldn't establish:\n• Who sent it could not be traced.\n\nWhat it checked: The domain was not reachable.");
  assert.equal(answer, `What Magnum DI couldn't establish:\n• Who sent it couldn't be traced.\n\nWhat it checked: The domain wasn't reachable.\n\n${PLAIN_WORDS} ${BY_ID.domain.meaning}`);
  const fixed = "ApolloSG's trusted knowledge doesn't cover that question yet, so I won't guess at an answer. If it's about something you've received — a message, link, email, call, app or file — tap + and add it, and Apollo's investigators will check it. Learn with Higgins has guides on the common scams.";
  assert.equal(luddishText(fixed), fixed, "HIG-08's fixed reply stays word for word");
  const ask = read("../app/(tabs)/ask.tsx");
  assert.match(ask, /!m\.quoted/);
  assert.match(read("../src/higgins/chatClient.ts"), /QUOTED_BASES = \["recognised_government_feed_cache", "scam_alert_card", "learn_with_higgins_catalogue", "apollo_knowledge_base"\]/);
});

test("a finished investigation's own record locks as recorded", () => {
  const lock = lockFromInvestigation({ revision: 1, overview: "Delivery scam.", explanationMarkdown: "", assessment: "concern_found", outcome: "likely_scam", attention: "action_needed",
    attentionReason: "The link leads to a lookalike site.", findings: [{ id: "f1", text: "The link domain is not auspost.com.au.", basis: "observation", confidence: "high", evidenceIds: [], sourceIds: [] }],
    uncertainties: ["Who sent it could not be traced."], scope: "The message text and its link.", sourceIds: [], remainingEvidenceIds: [], actions: [], recommendedActionId: null, question: null, completion: "complete" }, "TC FlyBy");
  assert.equal(lock.state, "likely_scam");
  assert.equal(lock.findings[0].basis, "observed");
  const ex = compose(lock);
  assert.equal(ex.fidelity.status, "PASS");
  assert.equal(ex.importance?.text, "The link leads to a lookalike site.");
  assert.equal(luddish("Nothing changed here.").keptLines.length, 0);
});
