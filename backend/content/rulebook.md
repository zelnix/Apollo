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
- **Privacy first.** Passwords and codes are removed on the phone, and an image showing one is not sent. Only allow-listed fields leave the device. Secrets are stripped again before every Gemini request. The full rules are under Privacy and redaction.
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
   - Under 60 characters: words about the phone working (working, running, active, on, off, enabled, disabled, status, state, ok, fine, healthy, broken, down) → its protection status, on the phone. Words about a threat (scam, scams, scammed, scammer, scammers, phishing, fraud, fraudulent, suspicious, malware, virus, viruses, hacked, hacker, hackers, compromised, stolen, unsafe, dangerous) → Higgins on the server. Both kinds, or neither, → the next step. Only whole words count, so "on" inside "someone" or "phone" doesn't.
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

## 7. Privacy and redaction {#privacy}

**The rule:** protect the person, preserve the evidence, share only what is necessary. Secrets are never sent. What shows whether something is a scam (the sender, their number, email address and links, any payment details and the words they used) is kept as evidence.

**Always removed, on the phone (never relaxed)**
Each of these is replaced with "[credential redacted]" before anything leaves the phone:
- a password, passcode or PIN given after "is", "was", ":" or "=";
- one-time, verification, security, sign-in and recovery codes, including "123456 is your verification code" and "code: 1234";
- any mention of a recovery phrase, seed phrase or mnemonic;
- bearer tokens, API keys, secret keys, and access and refresh tokens;
- a username and password written inside a link, and secret values in a link (token, password, secret, key, code or session).

**Removed again, on the server**
- Everything submitted is checked again for passwords, PINs, codes, usernames and login IDs, bearer tokens and secrets in links, and each one is replaced with "[redacted]".
- A word that only describes a secret ("password reset", "code required") is left alone.

**Before every Gemini request (one privacy boundary)**
- Secrets are stripped once more from the whole request, and a field that holds a credential is dropped.
- A field that holds unrelated personal data is sent as "[personal data withheld]", unless the request is an investigation the person asked for.
- Long tracking links are shortened: tracking parameters (utm, gclid, fbclid and similar) are removed, other values over 80 characters are cut, and any link over 200 characters is cut. The domain and path are always kept.
- Research and public-advisory requests also have personal identifiers replaced with labels: email addresses, phone numbers, card and account numbers, BSBs, TFNs, Medicare, ABN, passport and social security numbers.
- The original evidence is never changed; only the copy being sent is.

**Pictures**
- The picture's metadata is stripped first. If that fails, the picture is withheld.
- The phone reads the text in the picture. A password, PIN or code it finds is blacked out on a copy before sending, and the original on the phone is untouched. If it can't be blacked out, the picture isn't sent.
- If the phone's text reader isn't available, the picture isn't sent. The person can type the text instead.
- Personal details and sender information in a picture are kept as evidence.

**What may leave the phone**
- Every request is checked against its own list of allowed fields. Any other field stops the request: "Apollo couldn't safely prepare this request. Retry this step."
- Never accepted in any request: contacts, messages, SMS, email bodies, page content, the clipboard, location, IMEI, serial number, phone number or advertising ID. A number the person types to check is sent only as the number to check.
- In a link, credentials, the part after "#" and secret values are removed. The path is kept, because a scam page and a real homepage need different answers.
- What the person submits leaves the phone only for the check they asked for. It is never copied into Threats records, logs, analytics or background monitoring.
- **Threats records** synced to the server carry fixed wording ("Details stay on the device"), never the message, screenshot, file or link. Only a domain is kept as an indicator.
- **Family helpers** see fixed wording ("Security check — review with the protected person"), never the content.
- **Handing a result to Higgins:** at most 8 findings and 4 actions, each line short. Secrets, the person's own details and IP addresses are removed.
- **My Personal Data:** the person's own saved details (such as their name, email address or phone number) are replaced with a label, such as "[Email address redacted]", in message and email checks and in what a result hands to Higgins. IP addresses become "[ip address]".

**What is kept, and for how long:** see Your data.

---

## 8. Apollo's knowledge base (KB) {#knowledge-base}

**Job:** sourced general knowledge that Higgins and TC FlyBy can use with no AI. KB knowledge is general knowledge. It is never evidence about anything a person asked Apollo to check.

**What is in it**
| Kind | Where it comes from |
|---|---|
| Learn articles | Published Learn with Higgins articles, each linked to its screen |
| Scam alerts | Official alerts and advisories from the government feeds, in the source's own words |
| Official guidance | cyber.gov.au guidance shipped with Apollo (CC BY 4.0, attributed) |
| Scam patterns | The Scamwatch patterns TC FlyBy compares material against |
| Researched pages | Pages on trusted websites, found and kept up to date through Tavily |
| Saved AI answers | Gemini's answer to a general question nothing else covered, labelled as Gemini's. Never treated as sourced knowledge |

**Trusted sources.** A page on any other website never becomes Apollo knowledge.
- **Tier 1, official authority (24 websites):** government agencies, regulators, police and national cyber-security authorities in Australia, the US, the UK, New Zealand, Canada and the EU.
- **Tier 2, established security research (11 websites):** recognised research organisations and security companies.
- **Tier 3, supporting (5 websites):** credible specialist and consumer sources.
- A source is reproduced as a Learn article only when its licence allows it. Every other source is quoted briefly, with a link to read the rest.

**How Tavily is used**
- Only to find and re-read trusted pages for the KB. Never by TC FlyBy or Magnum DI, never in a live investigation, and never to answer a question as it is asked.
- Tavily is never the source. Its own generated answer is switched off, and every page it returns is checked against the trusted list again.
- **Once a week:** a run is due when the last successful run is 7 days old and no attempt was made in the last day. Staff can also start one from the admin portal.
- **Each run** searches 14 guidance topics on every tier (up to 5 results from Tier 1, 4 from Tier 2 and 3 from Tier 3) and 4 scam-alert topics in Tier 1 news. Up to 40 stored pages last checked 7 or more days ago are read again.
- Afterwards the KB brings in the latest Learn articles, scam alerts, shipped guidance and scam patterns.

**The checks every page must pass**
- It is on a trusted website, over https.
- It isn't a document file (PDF, Word, Excel, PowerPoint, zip, audio or video).
- It isn't a listing, tag, search, category or navigation page, and it has a title.
- No more than 40% of its words are links.
- It has at least 120 words of its own content, in English.

Only the page's own headings, paragraphs and bullet points are kept; menus, footers, banners and link lists are dropped. A page that fails is not stored as knowledge, and the reason is kept for 90 days for the admin portal.

**Nothing is invented, and history is kept**
- Knowledge is the source's own words. A fact the page doesn't state stays missing.
- **Same page:** if its words are at least 92% the same, it is only marked as checked again. If they changed, it becomes a new version and the old version is kept as Superseded. "Updated" shows for 30 days.
- **Same words on another page** (at least 85% the same) are recorded as another place it is published, not a new entry.
- A page Apollo already holds from a government feed, the shipped guidance or a Learn article isn't added again.
- **Historical, never deleted:** a page that fails to load on 2 re-reads, or a scam alert published more than 2 years ago.
- When the checks are tightened, a page that no longer passes is removed everywhere: its Learn article is archived and its Scam Alert withdrawn.

**Where a researched page is published**
- **Scam Alerts:** only a Tier 1 page found as an alert, published within the last 180 days, that Scam Alerts' fixed rules rate as a specific scam or an emerging pattern. It is rated by the same rules as the government feeds.
- **Learn with Higgins:** only from a source whose licence allows it, with at least 3 sections, practical bullet points and a summary, passing Learn's quality checks. It ends with a "Source and licence" section. An article staff archived is never brought back.

**How the KB is searched (no AI)**
- The question's content words are used, with common words removed and word endings lightly trimmed.
- An entry answers only if it holds every content word (for a question of 1 or 2 content words) or at least 75% of them, and its title shares at least one.
- A saved AI answer is reused only for the same question: every content word, or at least 80% of them for longer questions.
- Historical entries rank below current ones. At most 2 entries are used for one answer.

**How it is quoted**
- In the source's own words: the passages that best match the question, in their original order.
- Each quote names the publisher, its authority, where it applies and when it was published or last checked, with a link to read the original.
- A historical entry says it may be out of date. Guidance from outside Australia says contacts and reporting steps may differ.
- Every quote ends with: "This is general knowledge from Apollo's library. It isn't a finding about anything you've asked Apollo to check."
- A saved AI answer says that Gemini wrote it and that no official source has checked it.

**Saving an AI answer**
- Gemini's answer to a general question is saved only when the question holds no secret and no personal detail: no link, email address, number of 6 or more digits, "my name is", "I live at" or "my address".
- A simulated answer from the preview is never saved.

**Where the KB is used**
- **Higgins:** quoted as general knowledge (Higgins step 6), and for a general question asked about a finished case, kept apart from its findings.
- **TC FlyBy:** stage 2 (scam patterns, claims and general questions). Only sourced, current entries are used; saved AI answers and historical pages never are.
- **Preview:** the simulator answers from the KB instead of calling Gemini, and says so.

---

## 9. Settling rules: the reason shown on each result {#settling-rules}

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

## 10. Your data: what is kept and for how long {#your-data}

**The rule:** what the person sends Apollo lives on their phone. The server keeps only what a feature needs, only for as long as it needs it, and the person can delete all of it.

**On the phone (the person decides)**
| What | How long |
|---|---|
| Finished results | Until the person deletes the check, or deletes all their data |
| Pictures, files and originals sent for a check | Never deleted automatically. They stay until the person removes them, deletes the check they belong to, or deletes all their data |
| Ask Higgins chat | Up to 1 hour, and at most the last 40 messages |
| Calls Apollo screened (Android) | The last 50 calls, for up to 30 days |
| Email addresses watched for breaches | Until the person removes them. The last 12 scans are kept |
| Settings and preferences | Until the person deletes all their data or uninstalls Apollo |

**On Apollo's server**
- **Investigations:** the content is encrypted with a key used for nothing else, and the server's working copy expires 15 minutes after it opens. Retries and reads never extend it. The finished record lives on the phone; the server doesn't keep finished investigations.
- **Pictures and files:** everything submitted for a check (pictures, files and text) is deleted from the server within 24 hours of the investigation finishing, whether it was answered, failed or was cancelled. A check that is still running is never cut short: the 24 hours start when it finishes, and start again if a follow-up question sends it back to work. Most of it goes much sooner, as soon as the phone has saved the result or with the 15-minute working copy. The database removes it by itself at 24 hours, even if Apollo's own clean-up has stopped, and it is never served after that.
- **The note on each result.** Every saved result says when its pictures and files were removed from Apollo's server, or the latest time they will leave it. Results saved before this note existed say only that they have left, once 24 hours have passed.
- **Ask Higgins:** the question and answer for 5 minutes, then a receipt with no content for 30 days (see Ask Higgins).
- **What Higgins remembers between chats:** a recent result for 7 days, protection status for 1 hour, a preference for 90 days, a goal for 30 days and a permission for 1 day. At most 25 of each kind and 100 in all.
- **Threats records:** fixed wording and a domain only (see Privacy and redaction). Kept until the person clears the Threats history, which hides them, or deletes all their data, which deletes them.
- **Remembered gate results:** a possible threat for 30 days and no threat for 7 days, kept against a fingerprint (a one-way code) of what was checked.
- **TC FlyBy's search answers:** 7 days, filed under a code made from the question. They are shared, and never tied to the person who asked.
- **Trusted links:** until the person removes the link.
- **Gmail:** an encrypted sign-in token, until the person disconnects. Message content is never stored (see Email and accounts).
- **Family links:** until the person unpairs. A Family Help session is deleted 30 days after it starts.
- **The phone's anonymous sign-in:** valid for 365 days.
- **Diagnostics:** device registration, protection-health checks and alert-delivery records, with no personal content. Kept until the person deletes all their data, unless they expire sooner.
- **Saved AI answers:** kept only when the question holds no secret and no personal detail (see Apollo's knowledge base).

**Deleting everything**
- **Settings → What Apollo stores → Delete My Apollo Data** first wipes everything Apollo keeps on the phone. It then deletes everything the server holds for this phone, in 7 groups: Higgins conversations, Investigations & saved reports, Patrol activity & records, Trusted links, Email & account monitoring, Family links & guardians, and Diagnostics & app signals. Last, it removes the phone's identity, so Apollo starts again as a new anonymous device.
- The same screen counts what the server holds in each group before anything is deleted.

---

## 11. Threats list {#threats-list}

**Job:** one record for each check, showing what Apollo found and what to do next.

**One record, never twins**
- Each check creates exactly one entry. The phone's first detection and the later investigation update the same card.
- Records that name the same investigation are one case. Repeat checks of the same subject show as one case with the latest result, and every check stays in its history.
- Two records are the same finding only when they share an investigation, an explicit link between them, or the same verified indicator. A brand, website or scenario in common never merges two findings.
- The same issue with the same details again within 24 hours is recorded as a repeat, not a new finding.

**What each status means**
| Status | When |
|---|---|
| Investigating | Only while an investigation is actually running |
| Blocked | Only when real block evidence confirms it |
| Needs you | Apollo is Barking or Biting |
| Keeping watch | Apollo is Growling, or something is worth a closer look |
| Handled | The person resolved it |
| No threat | It was resolved with nothing found |

**Rules**
- **Biting only for a real block** (see Apollo detection). The server rejects any Biting claim without the block evidence, and an edit can never turn a record into Biting.
- A handled finding reopens only when genuinely new detection evidence arrives. A repeat of old evidence never reopens it.
- Each finished investigation shows "Settled by TC FlyBy" or "Settled by Magnum DI". The badge is left off when the record doesn't say, rather than guessed.
- **Alerts:** Barking and Biting always come through and can't be turned off. Growling and Sniffing alerts can be turned off, and during quiet hours they wait until the quiet time ends; they are never dropped. Family helpers see fixed wording, never the content.
- **Clear Patrol history** (Settings) hides every record on the phone and on the server. Trusted links are kept.

---

## 12. Websites and links {#websites-links}

**Job:** check a link before it is opened.

**How a link is checked**
- The link is checked exactly as given: Apollo's blocklist and Google Safe Browsing, then up to 5 redirects followed to the final address. A link that redirects more than 5 times is judged as given, and the gap is recorded.
- The domain's registration record (RDAP) is fetched alongside it. It adds detail but never decides the result.
- Every link Apollo checks, in a message, an email or on its own, gets the same check.
- There are 21 link rules, covering links, QR codes, data links and real-time phishing relays.
- **Never a threat on their own:** an http link, a bare IP address, punycode, an unusual port, a risky TLD, a link shortener, a long link, deep subdomains, encoded characters, a newly registered domain, a QR code itself, and data or blob links.
- **QR codes:** the address inside is checked as a link. The QR code itself is never a threat.
- A link the person checks themselves opens an investigation, which TC FlyBy and Magnum DI pick up as usual.

**Website protection (Android)**
- An on-device filter, run through Android's private VPN, blocks known dangerous websites before they load. Browsing is checked on the phone and never sent anywhere.
- A blocked website reaches Biting only when the filter actually blocked the connection.

**Trusted links**
- Trust covers only the exact link the person chose. Removing it ends the trust.

---

## 13. Messages and calls: Call Guard and Text Guard {#call-text-guard}

**Call Guard (Android)**
- Works only when the person makes Apollo the phone's caller ID & spam app. Android then hands Apollo each incoming call before it rings, usually only from numbers that aren't in the person's contacts.
- Apollo never listens to a call and never reads the call log. It sees only the one incoming number.
- It compares that number with three lists kept on the phone: numbers the person blocked, numbers they allowed, and numbers this phone looked up earlier and found high-risk.
- An allowed number always rings. For a blocked or high-risk number, Apollo asks Android to reject the call. Android gives no receipt, so this is recorded as a request, never as a confirmed block. Calls never reach Biting.
- Every other call rings normally. Apollo never delays or silences a call on a guess, and if screening fails the call rings.
- A number with no local signal is queued (up to 20) and looked up the next time Apollo is open. Android allows only a few seconds to answer, which is too short for the lookup.
- A number's risk score is a likelihood, never proof. On its own it can only raise a warning.
- **Calls Apollo screened:** the last 50 calls, for up to 30 days, kept on the phone only.
- **iPhone:** Apple lets no app screen calls. Apollo says so rather than suggesting protection it can't give.

**Text Guard**
- **Android:** optional, through notification access. Apollo reads each new text-message notification from the phone's default messaging app as it arrives, never the message inbox or history. Notifications from other apps, such as WhatsApp, Telegram and Messenger, are not read.
- Store builds of Apollo never ask to read text messages or the call log.
- **iPhone:** Apple gives apps no way to read Messages. The person can paste a message, use a screenshot, or share it to Apollo where the app offers Share.
- Every message goes through the same checks as a pasted one: 30 message rules, plus the link check for each link. Calls have 16 rules of their own.
- **Never a threat on their own:** an unknown sender, urgency, an ordinary payment discussion, PayID/Osko use, a brand mention, a job, investment or romance discussion without scam mechanics, an unknown caller, a number that isn't in contacts, and a number's reputation without matching behaviour.

---

## 14. Email and accounts {#email-accounts}

**Gmail**
- Read-only access only. Apollo never sends, deletes, labels or changes anything in the mailbox, and never sees or stores the mailbox password.
- The person connects through Google's own sign-in, and the sign-in link expires after 10 minutes. More than one account can be connected.
- The connection, an encrypted token, is kept until the person disconnects. Disconnecting also cancels it with Google.
- **Monitoring:** every 15 minutes, Apollo reads the next 15 messages of each connected account and gives each one the same checks as a pasted email.
- Message content is used for that check only and never written to Apollo's database. A receipt for each message, with no content, stops it from being checked twice.
- An attachment is checked by its fingerprint when the file-reputation service is connected; the attachment itself isn't uploaded.
- There are 19 email rules. **Never a threat on their own:** a calendar invitation, a form-builder domain, valid sender checks (SPF, DKIM and DMARC) from a form provider, and an address appearing in a breach.

**Account checks**
- The email addresses the person watches stay on the phone.
- Each scan sends an address once to the breach service, Have I Been Pwned when it is connected and XposedOrNot otherwise, and the address isn't stored or logged.
- Apollo never asks for a password. Anything in a pasted account alert that looks like one is removed before it is checked.
- Links in a pasted account alert are compared with the organisation's official websites.
- "No breach found" is never called proof that the account is safe.

---

## 15. Apps and files {#apps-files}

**Files**
- **Trust the file, not its name.** The phone compares the file's real type with its name, and looks for double extensions, right-to-left name tricks, archives, app packages, profiles, certificates and links inside.
- Files can be up to 10 MB. The phone reads the start of the file and a text sample; nothing is uploaded for this first look.
- Links inside a file are checked as links.
- If the file is sent for an investigation, the server decides its type from its own bytes, not its name, and records any mismatch.
- Apollo only ever cleans up the copy its own picker made. A shared original is never touched.
- There are 19 file rules. **Never a threat on their own:** encryption or password protection, ordinary file characteristics, and a QR code itself.
- Apollo never calls a file 100% safe, and unknown never means malicious.

**Apps**
- Apollo doesn't judge an app by its name. It looks at what the app is allowed to do, where it came from and what happened around the install.
- It works from what the person tells Apollo plus what the phone's security checks can see, and never pretends to read other apps.
- Up to 10 web addresses the app uses are checked against the same reputation sources as a link.
- A remote-access app matters when it follows a suspicious call, message or website.
- There are 14 app rules. **Never a threat on their own:** an app from an official store, permissions the app is expected to need, and installing a web app.

---

## 16. Device and internet {#device-internet}

**Device check**
- Apollo shows only what this phone and this version of Apollo can truly see, plus what the person reports. It is never a full scan. Anything it can't see is shown as not visible, never as safe.

| Result | Meaning |
|---|---|
| Protected | No meaningful issues detected within what Apollo can see here. |
| Review recommended | Some permissions or settings deserve attention. |
| Action required | A high-risk configuration or app was detected. |
| Recovery | Risky access was already granted. Follow the steps — Apollo stays with you. |

- **Security & Privacy Review:** the same 9 areas on every kind of device. Each setting gets one of: Checked, Review recommended, Action required, Manual review required, Unavailable or Not applicable. The review is never one blanket "Protected".
- **Protection changes** say only what changed, never who changed it or why. A setting Apollo couldn't read is never counted as a change, and Apollo's own protection VPN is recognised as Apollo's.
- There are 15 device rules. **Never a threat on their own:** expected management or device administration, expected accessibility access, Apollo or a trusted VPN, developer options, a custom DNS or DoH provider, notification permission, and signals the platform can't provide.

**Internet (Check this network)**
- Apollo uses only what the phone reports: connection type, Wi-Fi security, a sign-in page (captive portal) and VPN status. The person adds where they are (home, work or school, a public place, or not sure), the network name they expect, and whether they turned the VPN on.
- Public isn't malicious, open isn't intercepted, and a VPN the person chose is fine.
- There are 9 network rules. **Never a threat on their own:** public Wi-Fi, open or WEP Wi-Fi, an unknown Wi-Fi network, a lookalike network name, a captive portal, a trusted home or work connection, and a mobile data connection.

---

## 17. Scam Alerts and government feeds {#scam-alerts}

**Job:** show the specific scams that official sources are reporting, each explained from the source itself.

**Where alerts come from**
- Recognised government and official cyber-authority sources in Australia, the USA, the UK and the EU, plus Tier 1 pages found for Apollo's knowledge base (see Apollo's knowledge base).
- Each source is named in full, never as a bare acronym.

**How often feeds are read**
- Each feed is read on its own schedule, between every 15 minutes and once a day (hourly unless set otherwise).
- An item stays for 90 days after it was last seen in its feed.
- In the app, a feed shows as stale when its last successful read is more than 6 hours old, or its latest read failed.
- For staff, a feed is healthy, stale (no successful read in 24 hours) or failing (its latest read failed, with the error in plain words).

**What is shown**
- Only items that have been read and explained. An item that hasn't been read yet is never shown as a scam alert.
- Only specific scam campaigns and emerging patterns. General scam education goes to Learn with Higgins.
- Only recent reports: an item dated more than 180 days ago is left out. An undated item stays, because its age can't be proven.
- The most recent first, up to 50.
- Each alert once: an article its feed lists twice is shown once, and a link a feed wraps in page code is read for the article's real address.
- **Growling for an alert:** only for a specific scam rated High or Extreme that has reached Australia, or that may reach Australia and was reported within the last 180 days.

---

## 18. Phone permissions {#permissions}

**The rule:** Apollo asks only when the person chooses something that needs the permission, and says why first. If the person says no, Apollo asks once more at most, when the phone allows it, and after that offers Open Settings. Saying no only switches off that one feature.

| Permission | What it's for | When Apollo asks |
|---|---|---|
| Notifications | Receive important threat and family alerts | During setup, or with Allow security alerts in Settings |
| Camera | Scan QR codes and photograph suspicious items for Apollo to check | When the person scans a code or takes a photo |
| Photos | Pick images of suspicious content for Apollo to investigate | When the person chooses a picture or a screenshot |
| Website protection (Android) | Run Apollo's on-device VPN filter | When the person turns on website protection |
| Notification access (Android) | Text Guard reads new text-message notifications | When the person turns on message screening |
| Caller ID & spam app (Android) | Call Guard screens incoming calls | When the person turns on call screening |
| Gmail read-only (an account, not a phone permission) | Check a connected mailbox | When the person connects Gmail |

- **Never asked for:** the microphone and location. Store builds never ask to read text messages or the call log.
- Where a phone hides Wi-Fi details without location permission, Apollo shows them as unknown rather than asking.
- A reminder to set up a protection the person skipped comes back after about 3 days, only while it is still off.

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
