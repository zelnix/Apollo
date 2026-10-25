# Apollo rule book

How a check moves through Apollo, the rules each part follows, when a check is settled, what sends it to the next step, and what information can be requested. Written from the code, word for word the same in the app (Settings → Rule book) and the admin portal.

_Last reviewed against the code: 2026-10-25._

This is the only copy. Whenever a rule or process changes, this book is updated in the same change. An automatic check stops the change until it is.

**The path of every check**

Apollo detection (the gate) → *only if Possible Threat* → one investigation case → **Higgins Triage** → **TC FlyBy** (official sources → Apollo KB → one targeted search) → settled, *or* → **Magnum DI** (one Gemini call) → **Higgins** explains the result.

Each check creates exactly one entry in the Threats list. The phone's first detection and the later investigation update the same card.

---

## 1. Apollo detection (the gate)

**Job:** detect and protect. Uses no AI.

**Process**
1. **First look on the phone.** Fixed rules give the check one of six states: Checking, Patrolling, Sniffing, Growling, Barking or Biting.
2. **Specialist lookups, gathered once.** These are Google Safe Browsing and Apollo's blocklist, the domain registration record (RDAP), redirect expansion, IPQualityScore (links and phone numbers), direct-download detection, official scam advisories and breach data. TC FlyBy and Magnum DI reuse these results; they never repeat them.
3. **Gate rules.** A fixed catalogue of 153 rules covers links/QR, messages, calls, email/accounts, files, apps, device, network and correlated sequences. Each source type is checked only against its own rule groups.
4. **Retries.** A temporary failure gets up to 3 attempts. This covers a provider not answering, a network failure, content that couldn't be opened, or a check error. Permanent limits are never retried.

**Gate outcomes**
| Outcome | When |
|---|---|
| **Possible threat** | At least one rule is met. This opens **one** investigation case. |
| **Limited / unable to determine** | No rule was met, but evidence was missing (a coverage gap), or concerning signs didn't meet a rule. No case is opened, and the person is told what Apollo couldn't see. |
| **No threat identified** | No rule was met and every applicable check completed. |

**Rules**
- Missing evidence is a coverage gap. It can block "no threat", but it never creates a threat and never weakens real threat evidence.
- **Never a threat on their own:** unknown sender or caller, urgency, a brand mention, PayID/Osko use, link shorteners, a new domain, risky TLDs, public Wi-Fi, developer options, official-store apps, encryption alone, and similar weak signals.
- **Cache:** a possible threat is kept 30 days and no threat 7 days. Limited results are never cached.
- **Biting only for a real block.** The DNS, VPN or packet filter must have actually blocked the connection. The block must be fresh (within 60 seconds), on this device, for this event, and on a real platform (not mock). Calls can never reach Biting. Link, email and text checks go no higher than Barking.
- **Unknown is not unsafe.** A setting Apollo couldn't read is never counted as a change. "No concern" covers only the checks that completed. Nothing is ever called safe.
- **Privacy first.** Passwords and codes are removed on the phone, and an image showing one is not sent. Only allow-listed fields leave the device. Secrets are stripped again before every Gemini request.
- **Protection changes** say only what changed, never who changed it or why. The "what to do" lines are fixed text.

**What sends a check onward:** a Possible Threat result. A check the person starts (Check It, or Ask Higgins with something to check) enters the same investigation pipeline.

---

## 2. Higgins Triage (inside the case)

**Job:** gets everything ready. It does not investigate and never decides whether something is a scam. It works offline, uses no AI and costs nothing.

**Process**
1. **Reads every input:** the submitted text and links, the text the phone read from screenshots and images, and the text layer of documents.
2. **Records what it couldn't read, and never guesses it:**
   - An image with no readable text, a scanned page with no text layer, or pictures on a page are marked **"Magnum DI can read this"**.
   - An unavailable item, a document whose text couldn't be extracted, audio or other attachments are recorded as a gap Magnum DI can't fill.
3. **Extracts:**
   - links and domains (max 5)
   - phone numbers (8–15 digits, never dates, BSBs or account numbers; max 3)
   - email addresses (max 3)
   - organisations named (whole-word match against the brand register)
   - companies (max 2) and people
   - ABN, ACN, and AFSL/ACL licence numbers
   - financial claims and quoted phrases
   - payment details (BSB, account, PayID, crypto wallet), amounts and urgency
   - how items relate: organisation ↔ link, email or number; company ↔ ABN or licence; person ↔ company
4. **Requests to act.** A request counts only when an action is tied to what it asks for. Negated requests ("we will never ask for your password") don't count. The 9 types are:
   - payment
   - credentials
   - personal details
   - remote access
   - gift cards or crypto
   - changed payment details
   - call back
   - reply
   - open a link

   **Consequential requests** are the first six, plus a call-back when an organisation is named.
5. **Message type:** investment, family impersonation, tech support, delivery/toll, government, bank, job, romance, prize, invoice or unknown. A submission can also be classed as link only or as a general question.
6. **General question.** This applies only when nothing was submitted except the question, it holds no identifier or amount, it is 40 words or fewer, it is phrased as a question, and it doesn't describe something that happened to the person.
7. **Plans the checks.** Each check asks one narrow factual question about one exact value:

| Check | Question asked |
|---|---|
| Link (each domain) | Is this exact domain named in any scam, phishing, fraud or security warning? |
| Impersonation (each organisation named, max 2) | No search. Do the links and addresses match the organisation's official domain? |
| Phone / email | Is it named in scam warnings, or is it a published official contact? |
| Company | Is it a registered business? Is it on ASIC's Investor Alert List or in any warning? |
| ABN / ACN | Who is it registered to, and is it active? |
| Licence | Who holds it on ASIC's register, and is it current? |
| Person + company | Is the person publicly associated with the company? |
| Quoted phrase | Does this exact text appear elsewhere online or in scam warnings? |
| Claims, scam alerts | Apollo KB only |
| Message analysis | Planned, but it reaches Magnum DI only if the deciding test says so |

---

## 3. TC FlyBy

**Job:** a fast, low-cost investigation that takes the cheapest reliable route. It runs once per case; a Magnum DI retry reuses its record and repeats no lookups.

### Stage 1: official and direct sources (no AI, 8 s per lookup)
- **Link**
  - On Apollo's official-domain register (government and regulator domains, plus organisations' own domains) → **settles it as clear**.
  - Redirects somewhere → warning sign. The final destination is checked too.
  - Listed by Safe Browsing or Apollo's blocklist → **decisive concern**. Not listed → clear.
  - Registered less than 90 days ago, or flagged as new → warning sign.
  - Flagged by IPQualityScore (phishing, malware or suspicious) → warning sign.
  - Downloads a file directly → warning sign.
  - Named in an official scam advisory → **decisive concern**.
  - A lookup that fails is recorded as "couldn't be checked", never as safe.
- **Impersonation**
  - Every link and address uses the organisation's domain → clear.
  - The organisation's name sits *inside* another address (a lookalike such as commbank-notice.net) → a warning sign on its own.
  - The name is only *mentioned* beside someone else's address → needs corroboration.
- **Phone:** an IPQualityScore fraud score of 85 or more, or recent abuse → warning sign.
- **Email:** an official domain → clear. A free personal account (Gmail and similar) while an organisation is named → warning sign, but it needs corroboration.
- **ABN/ACN:** checked with the official check-digit test. A fail is a warning sign and settles the check.

**Stops here only for a decisive concern → Confirmed scam or threat.**

### Stage 2: Apollo Knowledge Base (no AI)
- **Scam patterns.** There are 8 patterns from Scamwatch: family "new number" ("Hi Mum"), organisation phishing, delivery/toll, government threat, unexpected money or prize, job/paid task, investment returns, and remote access/tech support.
  - **Full match:** every defining indicator plus the ask. Organisation phishing also needs an organisation named and a link that isn't its own. Delivery/toll needs a link that isn't official.
  - **Opening:** every indicator but no ask yet. This applies to the family pattern only.
  - **Partial:** some indicators. This establishes nothing on its own.
  - Indicators are phrases, never single keywords. Negated phrases don't count.
- **Claims.** Guaranteed returns, % per day/week/month, "risk-free", "double your money" or "can't lose" → a warning sign, cited to Scamwatch. Other claims are neutral.
- **General question.** An answer found in the KB settles it.
- **Limits.** Only sourced, current KB entries are used. Saved AI answers and historical pages are never used. KB content is general knowledge, never evidence about the sender.

**Still stops only for a confirmed threat, or an answered general question.**

### Stage 3: one targeted web search
- Only open checks with a question get here: at most 6 questions in **one** call to the low-cost model, with Google Search. The cache is checked first; answers are kept for 7 days.
- The model is told to look facts up and never to judge whether something is a scam.
- An answer counts only if a real web page backs it. If no page backs it, the answer is unsourced and not used. "No record found" is recorded as missing, never as clear.
- How answers are treated:
  - A warning from an **official** source that names the exact link, number, email or company → **decisive → Confirmed**.
  - Any other warning → a concern, but not decisive.
  - "Official contact" → clear.
  - "Copied elsewhere" → warning sign.
- **Register entry for an ABN, ACN or licence:**
  - Matches the name in the material → clear.
  - A related but different name → conflict, sent to Magnum DI.
  - No match → warning sign.
- A failed search is recorded as unavailable and passed on.

### The deciding test
*"Could deeper investigation change Apollo's finding or what Higgins tells the person?"* If not, TC FlyBy settles the case. "Unable to determine" is a valid finished result.

**How the outcome is chosen (first that applies):**
1. **Confirmed scam or threat:** a decisive concern was found.
2. **Likely scam:** a full pattern match that nothing contradicts. A contradiction is an impersonation pattern where every link and address is the organisation's own.
3. **Concerning:** corroborated impersonation. An organisation is named, a link isn't its domain, and an independent fact about that same link backs it up (new domain, flagged, redirect or download).
4. **Concerning:** the opening of the family pattern, with no ask yet.
5. **Concerning:** any established warning sign. A name mentioned beside another organisation's address counts only once something corroborates it.
6. If none of these applies, check the Magnum DI triggers below.
7. **No scam indicators found:** only when everything was checked. There are no gaps and no failed lookups, and every link is either an official domain, or not listed *and* of established registration.
8. Otherwise: **Unable to determine**.

Concerning, Likely scam and Confirmed lead to the same protective action, so Magnum DI is never called just to move a case between them.

### Triggers for Magnum DI (only when no concern outcome was reached)
| Capability | Trigger |
|---|---|
| **Reading** | Content Triage couldn't extract but Magnum DI can read: an image with no readable text, a scanned page, or the pictures on a page. |
| **Reasoning** | The material makes a consequential request (money, credentials, personal details, remote access, gift cards/crypto, changed payment details, or a call-back for a named organisation) through a route no official source verified. A route is verified only by an official domain, an official email domain, or a number the search confirmed as official. Payment details can never be verified. |
| **Relating** | Findings that contradict each other: a register entry under a related but different name; an organisation named beside an address that isn't its own, with nothing to corroborate it; or scam-pattern wording beside the organisation's real links while the request still goes somewhere unverified. |
| General question | Neither the KB nor the search could answer it. |
| Safety net | TC FlyBy's own result fails Apollo's validation, so Magnum DI takes the whole case with search on. |

The type of input, its category or uncertainty alone never sends a case to Magnum DI.

**What Magnum DI receives:**
- the person's question, once
- TC FlyBy's brief ("For Magnum DI to settle — only these"), with the facts that bear on each issue and any partial pattern match
- the evidence each issue needs
- anything TC FlyBy didn't examine
- any pre-gathered results Teddy had no reader for

What TC FlyBy already settled, and the raw lookups behind it, are not sent again.

**Magnum DI's web search is on only when** something is being read for the first time, a lookup failed, or a general question is still open.

---

## 4. Magnum DI

**Job:** a deep investigation, only when it could change the answer.

**Process**
1. It runs only when TC FlyBy hands it issues. On later turns it runs only when the person answers Magnum DI's own question.
2. **Size limit.** If the written evidence is over 10,000 words, nothing is sent, and the person is told the word count.
3. **One Gemini call** to the configured model.
   - There is one retry after 4 seconds, only for a temporary failure or an invalid answer. Configuration errors are never retried.
   - The limit of 2 calls per job is enforced on the job record.
   - If both calls fail, the person sees "Please resubmit in about 5 minutes". Everything submitted is kept, and Resubmit is one tap once the 5 minutes are up. There is no automatic resume.
4. There is no system prompt; the response shape and the outcome definitions travel in the schema. There are no tool rounds, no escalation to a bigger model and no second call to present the answer.
5. **The answer contains:**
   - overview and explanation
   - assessment and outcome
   - attention level (none, review, action needed or urgent) and the reason
   - findings, each citing evidence and marked as observed, reported by the person, or inferred
   - uncertainties and scope
   - actions and the recommended action
   - an optional question
   - completion: complete, partial or waiting for the person
6. Pages from Google Search are saved as case sources. They are leads, not verification.

**Validation (an invalid answer is rejected, never replaced with an invented one)**
- Findings may cite only registered evidence and sources. "Observed" needs evidence.
- "Concern found" needs at least one finding.
- "No concern" can't come with "action needed" or "urgent".
- The outcome must match the assessment.
- Phone actions need a capability the device advertises. "Open verified source" needs a registered source.
- Every action needs a label and an instruction. "Action needed" or "urgent" needs at least one action and a reason. If there are actions, a recommended one must be set.
- "Waiting for the person" needs a question, and a question needs that status.
- "Complete" only when all material evidence was examined; otherwise "partial".
- Gemini must have finished normally.

If the answer fails, the check fails honestly. The raw reply is kept only in the technical details.

**Information Magnum DI can ask for (no other part of Apollo can)**
- **A question to the person**, as free text, yes/no or multiple choice, always with the reason it's needed. The case waits, and the answer continues the investigation as a new turn.
- **A fresh device reading, a setting to open or a permission to grant**, only when the phone advertises that capability.

It can't override what is already established, and it isn't called to move a case between concern outcomes.

---

## 5. Higgins (explanation)

**Job:** explains and guides. Higgins never investigates. It may change how a result is presented, never what it means.

**Order before any AI is used**
1. **A follow-up on a finished investigation** is answered from its record, with no AI, and the case is never reopened.
   - It covers: checking again, what wasn't established, sources, evidence, confidence, what to watch for, why it's suspicious, what it means, what to do, and what was found.
   - Anything new (a link, email or phone number) is named as not covered: "start a new check".
   - A general question about that kind of scam is answered from the KB, labelled as general knowledge and kept apart from the case.
   - The answer credits whoever settled the check: TC FlyBy or Magnum DI.
2. **Something to check** → goes to the pipeline. What counts as something to check is set out under Ask Higgins below.
3. **A scam alert** the person opened → shown in the source's own words.
4. **A Learn article** → shown in its own words.
5. **Patrol records, the phone's live state, recent investigations or Apollo product knowledge** → shown as they are.
6. **Apollo's KB** → quoted with publisher and link, labelled as general knowledge.
7. **Off-topic** → a fixed reply, word for word: "I specialise in helping you stay safe from scams and cyber threats through Apollo. For that question, a general assistant would be a better fit. Is there anything security-related I can help with?"
8. **A general scam-safety question nothing else answers** → **one** Gemini call with the question alone (no device state, history or case). The answer is cached and reused.

**Rules**
- The phone's live reading is the truth. Higgins never contradicts it, guesses past it or invents a concern.
- Answering Magnum DI's pending question continues that investigation; it isn't treated as a follow-up.
- Plain Australian English, no internal codes, 2–4 short paragraphs.

---

## 6. Ask Higgins (the chat screen) {#ask-higgins}

**Job:** the one place to talk to Higgins. A question gets an answer. Something to check goes into the same investigation pipeline as every other check. Ask Higgins never decides whether something is a scam.

**Before anything is sent**
- Passwords, PINs and one-time codes are removed from the message on the phone.
- A message can be up to 4,000 characters.
- A question to Higgins carries only the question and a state-only reading of this phone: protections, permissions, threat counts, alerts and settings. It never carries messages, screenshots, files or secrets.

**Where a message goes (first that applies)**
1. **An investigation is open on screen.** The message goes to that case. Answering Magnum DI's question continues the investigation. Anything else about a finished case is answered on the phone from its record, as in Higgins step 1.
2. **"I want something checked."** The message has a check word *and* a subject word. The matching form opens, and the first subject mentioned wins. Higgins only says what to add, never a verdict. The person still supplies the item, and it goes through the full check.
   - Check words: check, checked, scan, investigate, verify, look at, have a look, "is this / that / it", scam, phishing, suspicious, legit, and safe to open / use / click / pay.
   - Subject words: screenshot, photo, picture, image or QR code; email, inbox or mailbox; message, text, SMS, call, caller, voicemail, number or WhatsApp; link, website, URL, web page, domain or site; app, file, attachment, download, APK or PDF; device, Wi-Fi, internet, network or router.
3. **Where something is, or how to do something** ("where is…", "how do I turn on…", "take me to…", "which screen…") → Higgins on the server, who answers with a tap straight to the screen.
4. **This phone's state:** protection status, device health, website, call, text or app protection, the VPN, permissions, current issues or the last check → answered on the phone from its live reading. Nothing is sent.
5. **Something suspicious, described without the form** ("is this a scam?", "I got a dodgy text", "someone called me…") → Higgins on the server.
6. **About Apollo itself:** how Apollo works, who Higgins or Magnum DI is, the protections, finding your way around, or what Apollo's states mean → a fixed answer on the phone, with taps to the right screens.
7. **A short message that's still unclear:**
   - Under 60 characters: words about the phone working (working, running, active, on, off, enabled, disabled, status, state, ok, fine, healthy, broken, down) → its protection status, on the phone. Words about a threat (scam, phishing, fraud, suspicious, malware, virus, hacked, compromised, stolen, unsafe, dangerous) → Higgins on the server. Both kinds, or neither, → the next step. These words are matched anywhere in the message, even inside a longer word ("on" in "someone").
   - Under 40 characters with no question mark → one question back: "Do you mean whether Apollo is protecting your phone, or would you like me to investigate something specific?"
8. **Everything else** → Higgins on the server, in the order set out under Higgins above.

**What starts a check from a typed message (on the server)**
- The message has to ask plainly: "is this / could this be" with scam, phishing, fraud, legit, safe, fake, suspicious, malicious or dodgy; or check, investigate, look at, look into, scan, verify, inspect or analyse; or "should I / is it safe to" with click, open, respond, reply, call or trust.
- *And* it has to hold something to check: a link, an email address, a phone number of 8 or more characters, or at least 30 characters of text.
- If either is missing, the message is answered as a question. Missing a check is preferred to starting one by accident.
- Higgins then says the check has started, and offers "View Investigation". If the check can't be started, the message is answered as a question instead.

**The + button: one form per kind of check**
| Form | What the person adds | The question if none is typed |
|---|---|---|
| Screenshot or photo | A screenshot, or a photo of a QR code, letter or screen | Is this a scam? |
| Websites & Links | A link, pasted or shared | Is this website safe? |
| Messages & Calls | A message, number or call details | Is this message a scam? |
| Email & Accounts | An email, pasted or picked from a connected inbox | Is this email legitimate? |
| Apps & Files | An app, file, download or attachment | Is this app safe to use? |
| Device & Internet | Anything noticed (optional) | Check my device and internet connection for security issues. |

- **Pictures.** The phone reads the text in the picture first, and that text goes with it. A picture showing a password, PIN or one-time code isn't sent, and nor is any picture when the phone's text reader isn't available.
- **Size.** A file or picture over 10 MB is refused. An email's attachments over 10 MB in total aren't downloaded; they are listed, with advice to check each one on its own.

**Coming in from elsewhere in Apollo**
- **A scam alert:** its title, source, summary and official link go in as the first message, and Higgins answers in the source's own words.
- **A Learn article:** shown in its own words.
- **A Patrol finding, an incident or a Device Check result with no case:** explained on the phone from Apollo's own findings, in fixed wording, with no AI and no investigation. "Ask Apollo to investigate" starts a separate check only when tapped.
- **A result that has a case:** that case opens, and the question goes to it.
- **A screenshot from Check It:** starts a check straight away.

**Taps and offers**
- An answer offers at most 2 screens to tap, and only real Apollo screens.
- "Investigate this" or "Open Check It" appears only when the general-knowledge answer suggests it. Nothing starts until it is tapped.
- A general-knowledge answer is up to 2,000 characters.

**What is kept, and for how long**
- On the phone: the conversation for 1 hour, up to the last 40 messages, in the phone's secure storage.
- On the server: the question and answer for 5 minutes, then only a receipt with no content for 30 days.
- **Clear chat** (the bin icon, after a confirm) deletes the conversation on the phone and on the server, and forgets the person's most-asked questions. It doesn't delete investigations.

**Suggestions**
- There are 20 quick questions. Four show while the chat is empty, and the person's own most-asked questions (asked at least twice) take up to 2 of those places.
- Once a conversation has started, up to 3 of the person's most-asked questions show above the message box while it is empty.
- Apollo remembers up to 30 asked questions, skipping any under 6 or over 120 characters.

**When something goes wrong**
- Higgins can't answer: "Higgins couldn't answer right now. No investigation was started.", with Try again.
- A general-knowledge answer comes back unreadable: Higgins says so, and nothing is made up in its place.
- **A stopped investigation** (both Magnum DI calls failed): once it can be resubmitted, one quiet note shows above the conversation. The note goes when the case is resubmitted, answered, removed, dismissed or past its expiry. There is no pop-up anywhere else.

---

## 7. Settling rules: the reason shown on each result {#settling-rules}

Every finished result can show one plain sentence naming the rule that settled it, in the form **"Settled by TC FlyBy — Known scam, every step: …"**. People can turn the sentence off in Settings → App. Staff see the same sentence on each case in the admin portal. The sentence never repeats anything from what the person sent.

| Rule ID | Rule | Settled by | When it applies |
|---|---|---|---|
| FLYBY-THREAT | Confirmed threat | TC FlyBy | A direct safety check, an official scam advisory, or an official source found by the search names this exact link, number, address or company as a scam or threat. |
| FLYBY-PATTERN | Known scam, every step | TC FlyBy | A full match with a known scam pattern in Apollo's knowledge base, and nothing contradicts it. |
| FLYBY-IMPERSONATION | Corroborated impersonation | TC FlyBy | An organisation is named, a link isn't its website, and a separate check on that link backs this up. |
| FLYBY-OPENING | Known scam opening | TC FlyBy | The message opens like the family "new number" scam but hasn't asked for anything yet. |
| FLYBY-SIGNS | Established warning signs | TC FlyBy | The checks found real warning signs, but not enough to call it a scam. |
| FLYBY-CLEAR | Nothing found, everything checked | TC FlyBy | Every planned check ran over everything sent and none found a scam indicator. |
| FLYBY-UNKNOWN | Can't establish more | TC FlyBy | The checks couldn't establish more, and a deeper look couldn't change what to do. |
| FLYBY-ANSWERED | Question answered from a source | TC FlyBy | A general question answered by Apollo's knowledge base or a sourced search. |
| MAGNUM-READING | Reading | Magnum DI | Part of what was sent (a picture or scanned page) had to be read directly. |
| MAGNUM-REASONING | Reasoning | Magnum DI | The material asks for money, details or access through a route no official source verified. |
| MAGNUM-RELATING | Relating | Magnum DI | TC FlyBy's findings pointed in different directions and needed weighing up. |
| MAGNUM-QUESTION | Open general question | Magnum DI | Neither the knowledge base nor a targeted search could answer a general question. |
| MAGNUM-SAFETY-NET | Safety net | Magnum DI | TC FlyBy's own result didn't pass Apollo's checks, so Magnum DI looked at the whole case. |

When Magnum DI was needed for more than one reason, the sentence names them together, for example "Reading and reasoning". Results recorded before these rules existed show no sentence rather than a guessed one.

---

## Outcomes (one system for TC FlyBy and Magnum DI)
| Outcome | Meaning |
|---|---|
| **Confirmed scam or threat** | An authoritative source names this exact link, number, address or company as a scam or threat. |
| **Likely scam** | The evidence and an established scam pattern point to a scam, without proof about this particular sender. |
| **Concerning** | Real warning signs, but not enough to call it a scam. |
| **Unable to determine** | The available evidence can't establish more. |
| **No scam indicators found** | The checks performed found nothing. This is **not** proof it's safe, and it is never described as safe. |

Every result shows **"Settled by TC FlyBy"** or **"Settled by Magnum DI"**, in the app and in the admin portal.

## Cost guardrails at a glance
- Gate and Higgins Triage: 0 AI calls.
- TC FlyBy: at most 1 low-cost search call per case (max 6 questions, 7-day cache).
- Magnum DI: 1 call, plus 1 retry only if that call fails, 2 at most.
- Higgins: 0 calls, except one cached call for a general question nothing else answers.
