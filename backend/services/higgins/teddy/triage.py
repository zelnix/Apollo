"""Apollo Triage — what came in, and what needs investigating.

    Apollo detects and protects. Apollo Triage decides what needs investigating.
    Teddy DI does the fly-by investigation. Magnum DI investigates deeply.
    Higgins explains and guides.

Triage does not investigate and never decides whether something is a scam. It reads the submitted
material, extracts the entities and signals in it, classifies the message type and plans the checks that
are relevant, so only those checks run.

It is deterministic and local: no network, no AI, no cost. Input it cannot classify is handed to Magnum
DI's single call as it is — there is no separate AI triage call.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from services.higgins.indicators import BRANDS, read_indicators

# ── Entity patterns ──────────────────────────────────────────────────────────
ABN_RE = re.compile(r"\bABN[\s:#.]*((?:\d[\s-]?){10}\d)\b", re.I)
ACN_RE = re.compile(r"\bACN[\s:#.]*((?:\d[\s-]?){8}\d)\b", re.I)
LICENCE_RE = re.compile(
    r"\b(AFSL|AFS\s+licen[cs]e|Australian\s+financial\s+services\s+licen[cs]e|ACL|Australian\s+credit\s+licen[cs]e)"
    r"(?:\s*(?:no\.?|number|#))?[\s:#]*(\d{5,7})\b", re.I)
URL_RE = re.compile(r"\bhttps?://[^\s<>\"')\]]+", re.I)
PHONE_RE = re.compile(r"(?<![\w@.+/])(\+?\d[\d\s().-]{6,}\d)(?![\w@])")
DATE_RE = re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$")
NOT_A_PHONE_BEFORE = re.compile(r"(bsb|account|acc\.?|card|ref(erence)?|invoice|order|abn|acn|afsl|licen[cs]e|tracking|po box)[\s:#no.]*$", re.I)
COMPANY_SUFFIX = (r"Pty\.?\s+Ltd\.?|Pty\.?\s+Limited|Limited|Ltd\.?|Inc\.?|LLC|PLC|Group|Holdings|Capital|Investments?|"
                  r"Trading|Markets|Securities|Financial|Finance|Wealth|Partners|Asset\s+Management|Funds?")
COMPANY_RE = re.compile(r"\b((?:[A-Z][\w&'.-]*\s+){0,3}[A-Z][\w&'.-]*)\s+(" + COMPANY_SUFFIX + r")(?![\w])")
LEADING_WORDS = {"the", "our", "your", "at", "from", "with", "dear", "hi", "hello", "this", "join", "contact", "call", "visit",
                 "and", "or", "by", "for", "via", "a", "an", "invest", "trade", "welcome", "to", "i", "we", "you"}
PERSON_RE = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})"
                       r"|(?i:\bmy name is|\bthis is|\bi am|\bi'm)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)")
CLAIM_RE = re.compile(
    r"guarantee[ds]?\s+(?:\w+\s+){0,2}(?:returns?|profits?|income|interest|payouts?)"
    r"|\b\d{1,3}(?:\.\d+)?\s?%\s*(?:(?:per|a|each|every)\s+)?(?:day|daily|week|weekly|month|monthly|year|annually|p\.a\.|returns?|profit|interest|roi)\b"
    r"|risk[- ]free|no risk|double your (?:money|investment)|can'?t lose|passive income", re.I)
QUOTED_RE = re.compile(r"[“\"]([^”\"]{40,300})[”\"]")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
QUESTION_START = re.compile(r"^(what|how|who|where|when|which|why|can|could|does|do|is|are|should|will|would)\b", re.I)
FACTUAL_START = re.compile(r"^(what|how|who|where|when|which|why|is there|are there|does|do)\b", re.I)
JUDGEMENT = re.compile(r"\b(should i|should we|is it safe|is it legit|legitimate|can i trust|safe to|worth it|a good idea)\b", re.I)
SITUATION = re.compile(
    r"\b(i|i'?ve|i'?m|we|we'?ve|my|me|us|our)\b.*\b(got|received|been sent|was sent|texted|emailed|called|rang|messaged|sent me|"
    r"asked me|told me|contacted|clicked|paid|gave)\b|\bthis (message|text|sms|email|call|link|site|website|number|offer|person|page|app)\b", re.I)
FREE_MAIL = {"gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "aol.com", "proton.me",
             "protonmail.com", "gmx.com", "mail.com", "bigpond.com"}

MESSAGE_TYPES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("investment", ("invest", "investment", "returns", "trading", "crypto", "bitcoin", "forex", "portfolio", "shares", "profit",
                    "dividend", "wealth", "financial advice")),
    ("family_impersonation", ("hi mum", "hi mom", "hi dad", "new number", "lost my phone", "broke my phone")),
    ("tech_support", ("remote access", "anydesk", "teamviewer", "virus", "your computer", "tech support", "microsoft support")),
    ("delivery_toll", ("parcel", "delivery", "package", "toll", "linkt", "redeliver", "tracking number", "shipment")),
    ("government", ("ato", "mygov", "centrelink", "medicare", "tax refund", "tax return", "services australia")),
    ("bank", ("bank", "netbank", "card", "account", "transaction", "payid")),
    ("job", ("job", "recruit", "recruiter", "salary", "work from home", "hiring", "position", "task")),
    ("romance", ("darling", "sweetheart", "my love", "dating", "relationship")),
    ("prize", ("winner", "you won", "you've won", "prize", "lottery", "reward", "congratulations")),
    ("invoice", ("invoice", "bank details", "payment details", "remittance", "overdue")),
)

MAX_LINKS, MAX_PHONES, MAX_EMAILS, MAX_COMPANIES, MAX_CLAIMS = 5, 3, 3, 2, 2


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = value.lower()
        if key and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def abn_valid(abn: str) -> bool:
    """The Australian Business Register's published ABN check-digit algorithm."""
    d = [int(c) for c in digits(abn)]
    if len(d) != 11:
        return False
    d[0] -= 1
    return sum(w * v for w, v in zip((10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19), d)) % 89 == 0


def acn_valid(acn: str) -> bool:
    """ASIC's published ACN check-digit algorithm."""
    d = [int(c) for c in digits(acn)]
    if len(d) != 9:
        return False
    remainder = sum(w * v for w, v in zip((8, 7, 6, 5, 4, 3, 2, 1), d[:8])) % 10
    return (10 - remainder) % 10 == d[8]


def registrable(host: str) -> str:
    """Last two labels, or three for AU-style second-level domains (commbank.com.au)."""
    parts = (host or "").lower().removeprefix("www.").split(".")
    if len(parts) >= 3 and parts[-2] in ("com", "net", "org", "gov", "edu", "asn", "id", "co") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else (host or "")


@dataclass
class Entities:
    urls: list[str] = field(default_factory=list)
    hosts: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    brands: list[tuple[str, str]] = field(default_factory=list)   # (organisation named, its official domain)
    companies: list[str] = field(default_factory=list)
    people: list[str] = field(default_factory=list)
    abns: list[str] = field(default_factory=list)
    acns: list[str] = field(default_factory=list)
    licences: list[tuple[str, str]] = field(default_factory=list)  # (licence type, number)
    claims: list[str] = field(default_factory=list)
    phrases: list[str] = field(default_factory=list)
    payments: list[str] = field(default_factory=list)
    amounts: list[str] = field(default_factory=list)
    credentials: list[str] = field(default_factory=list)
    urgency: list[str] = field(default_factory=list)

    def any_identifier(self) -> bool:
        return bool(self.urls or self.hosts or self.phones or self.emails or self.companies or self.abns or self.acns or self.licences)

    def wire(self) -> dict:
        return {k: [list(v) if isinstance(v, tuple) else v for v in getattr(self, k)] for k in self.__dataclass_fields__}


def _phones(text: str) -> list[str]:
    found: list[str] = []
    for match in PHONE_RE.finditer(text):
        value = match.group(1).strip(" .-()")
        count = len(digits(value))
        if not 8 <= count <= 15 or DATE_RE.match(value.replace(" ", "")):
            continue
        if NOT_A_PHONE_BEFORE.search(text[max(0, match.start() - 24):match.start()]):
            continue
        found.append(re.sub(r"\s+", " ", value))
    unique: dict[str, str] = {}
    for value in found:
        unique.setdefault(digits(value), value)
    return list(unique.values())


def _companies(text: str) -> list[str]:
    names: list[str] = []
    for match in COMPANY_RE.finditer(text):
        words = match.group(1).split()
        while words and words[0].lower().strip(".,") in LEADING_WORDS:
            words.pop(0)
        if not words:
            continue
        names.append(re.sub(r"\s+", " ", " ".join(words) + " " + match.group(2)).strip())
    return _dedupe(names)


def _claims(text: str) -> list[str]:
    sentences = [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]
    return _dedupe([s[:220] for s in sentences if CLAIM_RE.search(s)])


def _brands(text: str) -> list[tuple[str, str]]:
    """Organisations named in the material, matched as whole words ("ING" is not the end of "lodging")."""
    low = text.lower()
    found: list[tuple[str, str]] = []
    for needle, brand in BRANDS.items():
        if brand not in found and re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", low):
            found.append(brand)
    return found


def extract(text: str) -> Entities:
    """Every entity and signal the material itself states. No inference, no lookup."""
    ind = read_indicators(text)
    ent = Entities()
    ent.urls = _dedupe([u.rstrip(".,;") for u in URL_RE.findall(text)])
    url_hosts = {re.sub(r"^https?://", "", u, flags=re.I).split("/")[0].split("?")[0].split(":")[0].lower().removeprefix("www.")
                 for u in ent.urls}
    ent.emails = _dedupe([e.rstrip(".") for e in ind.emails])
    email_domains = {e.split("@")[-1].lower() for e in ent.emails}
    ent.hosts = _dedupe([h for h in ind.hosts if h in url_hosts or h not in email_domains])
    ent.brands = _brands(text)
    ent.abns = _dedupe([digits(m) for m in ABN_RE.findall(text)])
    ent.acns = _dedupe([digits(m) for m in ACN_RE.findall(text)])
    ent.licences = list(dict.fromkeys(("ACL" if "credit" in kind.lower() or kind.upper() == "ACL" else "AFSL", number)
                                      for kind, number in LICENCE_RE.findall(text)))
    masked = ABN_RE.sub(" ", ACN_RE.sub(" ", LICENCE_RE.sub(" ", URL_RE.sub(" ", text))))
    ent.phones = _phones(masked)
    ent.companies = _companies(text)
    ent.people = _dedupe([(a or b).strip() for a, b in PERSON_RE.findall(text)])
    ent.claims = _claims(text)
    ent.phrases = _dedupe([q.strip() for q in QUOTED_RE.findall(text) if 8 <= len(q.split()) <= 40])
    ent.payments, ent.amounts, ent.credentials, ent.urgency = ind.payments, ind.amounts, ind.credentials, ind.urgency
    return ent


def message_type(text: str, ent: Entities) -> str:
    low = text.lower()
    best, score = "unknown", 0
    for kind, terms in MESSAGE_TYPES:
        hits = sum(1 for term in terms if re.search(rf"\b{re.escape(term)}\b", low))
        if kind == "investment" and ent.claims:
            hits += 2
        if hits > score:
            best, score = kind, hits
    return best


def general_question(question: str, material: list[str], ent: Entities) -> bool:
    """A question about the world rather than material to check: nothing submitted beyond the question itself,
    no identifier in it, short, phrased as a question and not describing something that happened to the person."""
    q = " ".join((question or "").split())
    norm = q.lower().strip(" ?.!")
    if not q or any(" ".join(m.split()).lower().strip(" ?.!") not in (norm, "") for m in material):
        return False
    if ent.any_identifier() or ent.amounts or len(q.split()) > 40:
        return False
    if not (q.endswith("?") or QUESTION_START.match(q)):
        return False
    return not SITUATION.search(q)


def factual(question: str) -> bool:
    """Straightforward factual retrieval (who/what/where/how…), not a judgement call about the person's situation."""
    q = (question or "").strip()
    return bool(FACTUAL_START.match(q)) and not JUDGEMENT.search(q)


# ── The check plan ───────────────────────────────────────────────────────────
@dataclass
class Check:
    id: str
    kind: str
    subject: str
    question: str = ""                         # the narrow factual question for Teddy's search, when that stage applies
    statuses: tuple[str, ...] = ()             # the answers that question allows
    status: str = "open"                       # open | resolved | not_found | unavailable | needs_reasoning
    route: str | None = None                   # official_source | apollo_kb | google_search | magnum_di
    facts: list[dict] = field(default_factory=list)
    open_issue: str = ""                       # what only Magnum DI can settle
    urls: list[str] = field(default_factory=list)

    def wire(self) -> dict:
        return {"id": self.id, "kind": self.kind, "subject": self.subject, "question": self.question, "statuses": list(self.statuses),
                "status": self.status, "route": self.route, "facts": self.facts, "openIssue": self.open_issue, "urls": self.urls}

    @classmethod
    def from_wire(cls, data: dict) -> "Check":
        return cls(id=data["id"], kind=data["kind"], subject=data["subject"], question=data.get("question", ""),
                   statuses=tuple(data.get("statuses") or ()), status=data.get("status", "open"), route=data.get("route"),
                   facts=data.get("facts") or [], open_issue=data.get("openIssue", ""), urls=data.get("urls") or [])


@dataclass
class Plan:
    entities: Entities
    message_type: str
    checks: list[Check]
    has_message: bool
    link_only: bool
    general: bool
    unreadable: list[str]                      # evidence ids Teddy cannot read (images, documents without text)
    ambiguous: bool
    advisories: list[dict] = field(default_factory=list)   # official advisories Teddy's stage 1 matched
    pattern: dict | None = None                            # the established scam pattern (Apollo KB) the material matches best


WARNING_STATUSES = ("WARNING", "NO_WARNING_FOUND")


def plan(question: str, material: list[str], *, unreadable: list[str]) -> Plan:
    """Decide which checks are relevant to what came in. Nothing is looked up here."""
    text = "\n".join(material)
    ent = extract(text if material else question)
    general = general_question(question, material, ent)
    urls_only = bool(material) and all(URL_RE.fullmatch(m.strip()) for m in material if m.strip())
    has_message = bool(text.strip()) and not urls_only and not general
    checks: list[Check] = []

    def add(kind: str, subject: str, **kwargs) -> Check:
        check = Check(id=f"c{len(checks) + 1}", kind=kind, subject=subject, **kwargs)
        checks.append(check)
        return check

    if general:
        add("general_question", question.strip(), question=question.strip() if factual(question) else "", statuses=("ANSWER", "NO_RECORD_FOUND"))
        return Plan(ent, "general_question", checks, False, False, True, unreadable, False)

    for host in ent.hosts[:MAX_LINKS]:
        urls = [u for u in ent.urls if host in u.lower()]
        add("link", host, question=f'Is the exact domain "{host}" named in any scam, phishing, fraud or security warning?',
            statuses=WARNING_STATUSES, urls=urls)
    for name, official in ent.brands[:2]:
        add("impersonation", name, urls=[official])
    brand = ent.brands[0][0] if ent.brands else ""
    for phone in ent.phones[:MAX_PHONES]:
        add("phone", phone, question=(f'Is the phone number "{phone}" named in scam warnings or scam reports, or is it a published official '
                                      f'contact number of an organisation{f" such as {brand}" if brand else ""}?'),
            statuses=("WARNING", "OFFICIAL", "NO_RECORD_FOUND"))
    for email in ent.emails[:MAX_EMAILS]:
        add("email", email, question=(f'Is the email address "{email}" named in scam warnings or scam reports, or is it a published official '
                                      f'address of an organisation{f" such as {brand}" if brand else ""}?'),
            statuses=("WARNING", "OFFICIAL", "NO_RECORD_FOUND"))
    for name in ent.companies[:MAX_COMPANIES]:
        add("company", name, question=(f'Is "{name}" a registered business, and is it named on ASIC\'s Investor Alert List or in any regulator '
                                       'or scam warning?'), statuses=("WARNING", "REGISTERED", "NO_RECORD_FOUND"))
    for abn in ent.abns[:2]:
        add("abn", abn, question=f"Which entity is ABN {abn} registered to on the Australian Business Register, and is the ABN active?",
            statuses=("FOUND", "NO_RECORD_FOUND"))
    for acn in ent.acns[:2]:
        add("acn", acn, question=f"Which company has ACN {acn} on ASIC's companies register, and is it currently registered?",
            statuses=("FOUND", "NO_RECORD_FOUND"))
    for kind, number in ent.licences[:2]:
        label = "Australian credit licence" if kind == "ACL" else "Australian financial services licence"
        add("licence", f"{kind} {number}", question=f"Who holds {label} {number} on ASIC's professional register, and is it current?",
            statuses=("FOUND", "NO_RECORD_FOUND"))
    if ent.people and ent.companies:
        person, company = ent.people[0], ent.companies[0]
        add("person", person, question=(f'Is "{person}" publicly associated with "{company}" (for example as a director, representative '
                                        'or adviser)?'), statuses=("CONFIRMED", "NOT_CONFIRMED"))
    for phrase in ent.phrases[:1]:
        add("phrase", phrase, question=(f'Does this exact text appear elsewhere online — copied on other websites, or quoted in scam '
                                        f'warnings: "{phrase}"?'), statuses=("WARNING", "FOUND_ELSEWHERE", "NO_RECORD_FOUND"))
    for claim in ent.claims[:MAX_CLAIMS]:
        add("claim", claim, open_issue="Whether the return or financial claim in the material is credible.")
    mtype = message_type(text, ent)
    if has_message:
        add("scam_alerts", mtype)
        add("message_analysis", "the submitted material",
            open_issue="Message and deception analysis of the submitted material (requests, pressure, persuasion, intent).")
    if unreadable:
        add("image_analysis", f"{len(unreadable)} item(s) Apollo can't read without Gemini",
            open_issue="Interpretation of the screenshot or document content.")
    ambiguous = not ent.any_identifier() and not ent.brands and not ent.claims and not ent.payments and not ent.credentials
    return Plan(ent, "link_only" if urls_only else mtype, checks, has_message, urls_only, False, unreadable, ambiguous)
