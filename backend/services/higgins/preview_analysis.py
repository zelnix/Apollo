"""Evidence-specific analysis for the PREVIEW simulator only.

The preview simulator replaces the external Gemini call. It must still return a result that is about
THE ACTUAL EVIDENCE — naming the sender, the link, the amount, the request and the pressure found in
the submitted material — otherwise every preview investigation reads as a vague "characteristics that
may warrant caution" statement and tells the person nothing.

This is deterministic, rule-based and quotes only what is present in the evidence. It never claims a
source was contacted, never invents a verdict the text does not support, and marks every finding it
reasons (rather than reads) as an inference. Production uses the real model; nothing here runs when
APOLLO_PROVIDER_MODE is live.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class EvidenceBlock:
    """One evidence item as it was sent to the model."""
    evidence_id: str | None
    kind: str
    label: str
    text: str


# ── Indicators ───────────────────────────────────────────────────────────────

# Organisations commonly impersonated in Australia, with the domain they actually use.
BRANDS: dict[str, tuple[str, str]] = {
    "commbank": ("CommBank", "commbank.com.au"),
    "commonwealth bank": ("CommBank", "commbank.com.au"),
    "netbank": ("CommBank", "commbank.com.au"),
    "westpac": ("Westpac", "westpac.com.au"),
    "nab": ("NAB", "nab.com.au"),
    "anz": ("ANZ", "anz.com.au"),
    "bendigo bank": ("Bendigo Bank", "bendigobank.com.au"),
    "ing": ("ING", "ing.com.au"),
    "auspost": ("AusPost", "auspost.com.au"),
    "australia post": ("AusPost", "auspost.com.au"),
    "linkt": ("Linkt", "linkt.com.au"),
    "e-toll": ("E-Toll", "etoll.com.au"),
    "mygov": ("myGov", "my.gov.au"),
    "ato": ("the ATO", "ato.gov.au"),
    "medicare": ("Medicare", "servicesaustralia.gov.au"),
    "centrelink": ("Centrelink", "servicesaustralia.gov.au"),
    "telstra": ("Telstra", "telstra.com.au"),
    "optus": ("Optus", "optus.com.au"),
    "paypal": ("PayPal", "paypal.com"),
    "netflix": ("Netflix", "netflix.com"),
    "amazon": ("Amazon", "amazon.com"),
    "ebay": ("eBay", "ebay.com"),
    "microsoft": ("Microsoft", "microsoft.com"),
    "apple": ("Apple", "apple.com"),
    "google": ("Google", "google.com"),
    "woolworths": ("Woolworths", "woolworths.com.au"),
    "coles": ("Coles", "coles.com.au"),
}

CREDENTIAL_TERMS: dict[str, str] = {
    "password": "your password",
    "netbank password": "your NetBank password",
    "passcode": "your passcode",
    "pin": "your PIN",
    "one-time code": "a one-time code",
    "one time code": "a one-time code",
    "security code": "a security code",
    "verification code": "a verification code",
    "otp": "a one-time code",
    "2fa": "a two-factor code",
    "card number": "your card number",
    "cvv": "your card security number",
    "bsb": "your BSB and account number",
    "account number": "your account number",
    "tax file number": "your tax file number",
    "tfn": "your tax file number",
    "medicare number": "your Medicare number",
    "licence number": "your licence number",
    "log in": "your login",
    "login": "your login",
    "sign in": "your sign-in details",
    "verify your account": "your account login",
    "confirm your identity": "identity details",
}

PAYMENT_TERMS = ("pay", "payment", "fee", "fine", "toll", "invoice", "transfer", "refund",
                 "bitcoin", "crypto", "gift card", "voucher", "itunes", "steam card")

URGENCY_TERMS = ("immediately", "right now", "within 24 hours", "within 48 hours", "today",
                 "final notice", "last chance", "urgent", "suspended", "will be closed",
                 "avoid a fine", "avoid legal", "expires", "cancel it now", "act now")

URL_RE = re.compile(r"\bhttps?://[^\s<>\"')\]]+", re.I)
BARE_DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|au|co|io|info|xyz|top|shop|site|live|online)(?:\.[a-z]{2})?\b", re.I)
AMOUNT_RE = re.compile(r"(?:AUD\s?)?\$\s?\d[\d,]*(?:\.\d{2})?", re.I)
AU_PHONE_RE = re.compile(r"(?:\+61\s?4\d[\d\s]{6,10}|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b)")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def _host(url: str) -> str:
    host = re.sub(r"^https?://", "", url, flags=re.I).split("/")[0].split("?")[0].lower()
    return host[4:] if host.startswith("www.") else host


def _registrable(host: str) -> str:
    """Last two labels, or three for the AU-style second-level domains."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("com", "net", "org", "gov", "edu", "asn", "id") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


@dataclass
class Indicators:
    brands: list[tuple[str, str]] = field(default_factory=list)   # (display name, official domain)
    hosts: list[str] = field(default_factory=list)
    mismatched: list[tuple[str, str, str]] = field(default_factory=list)  # (brand, official, host)
    credentials: list[str] = field(default_factory=list)
    payments: list[str] = field(default_factory=list)
    amounts: list[str] = field(default_factory=list)
    urgency: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            out.append(value)
    return out


def read_indicators(text: str) -> Indicators:
    """Everything the evidence itself states. No inference yet."""
    low = text.lower()
    ind = Indicators()

    for needle, (name, official) in BRANDS.items():
        if needle in low and (name, official) not in ind.brands:
            ind.brands.append((name, official))

    hosts = [_host(u) for u in URL_RE.findall(text)]
    hosts += [h.lower() for h in BARE_DOMAIN_RE.findall(text) if h.lower() not in hosts]
    ind.hosts = _dedupe([h for h in hosts if h])

    for name, official in ind.brands:
        for host in ind.hosts:
            if _registrable(host) != _registrable(official) and (name, official, host) not in ind.mismatched:
                ind.mismatched.append((name, official, host))

    ind.credentials = _dedupe([plain for term, plain in CREDENTIAL_TERMS.items() if term in low])
    ind.payments = _dedupe([term for term in PAYMENT_TERMS if term in low])
    ind.amounts = _dedupe(AMOUNT_RE.findall(text))
    ind.urgency = _dedupe([term for term in URGENCY_TERMS if term in low])
    ind.phones = _dedupe(AU_PHONE_RE.findall(text))
    ind.emails = _dedupe(EMAIL_RE.findall(text))
    return ind


# ── The simulated investigation result ───────────────────────────────────────

def _finding(text: str, basis: str, confidence: str, evidence_ids: list[str]) -> dict:
    return {"text": text, "basis": basis if (basis != "observation" or evidence_ids) else "inference",
            "confidence": confidence, "evidenceIds": evidence_ids, "sourceIds": [], "supersedesFindingIds": []}


def _action(label: str, instruction: str) -> dict:
    return {"kind": "instruction", "label": label, "instruction": instruction,
            "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}


def analyse(blocks: list[EvidenceBlock], question: str = "") -> dict:
    """Build the investigation payload from the evidence that was actually sent."""
    text_blocks = [b for b in blocks if b.text.strip()]
    evidence_ids = [b.evidence_id for b in text_blocks if b.evidence_id]
    all_ids = [b.evidence_id for b in blocks if b.evidence_id]
    combined = "\n".join(b.text for b in text_blocks)
    ind = read_indicators(combined)

    findings: list[dict] = []
    actions: list[dict] = []
    examined: list[str] = []

    for block in blocks:
        words = len(block.text.split())
        examined.append(f"{block.label or block.kind}{f' ({words} words)' if words else ''}")

    # What the evidence says, quoted.
    if ind.mismatched:
        for name, official, host in ind.mismatched[:3]:
            findings.append(_finding(
                f"The content presents itself as {name} but the link goes to {host}, which is not {name}'s domain ({official}).",
                "observation", "high", evidence_ids[:2]))
    elif ind.brands and ind.hosts:
        name, official = ind.brands[0]
        findings.append(_finding(
            f"The link {ind.hosts[0]} matches {name}'s published domain ({official}).",
            "observation", "medium", evidence_ids[:2]))
    elif ind.hosts:
        findings.append(_finding(
            f"The content contains the link {ind.hosts[0]}. Nothing in the material identifies who operates it.",
            "observation", "medium", evidence_ids[:2]))

    if ind.credentials:
        asked = ", ".join(ind.credentials[:3])
        who = ind.brands[0][0] if ind.brands else "A genuine organisation"
        findings.append(_finding(
            f"It asks for {asked}. {who} does not ask for this by text, email or phone.",
            "observation", "high", evidence_ids[:2]))

    if ind.amounts or ind.payments:
        amount = ind.amounts[0] if ind.amounts else None
        payment_word = ind.payments[0] if ind.payments else "a payment"
        findings.append(_finding(
            f"It refers to {payment_word}{f' of {amount}' if amount else ''} and asks you to act on it."
            + (" Gift cards, vouchers and cryptocurrency are not used by legitimate organisations for bills or fines."
               if any(p in ("gift card", "voucher", "itunes", "bitcoin", "crypto", "steam card") for p in ind.payments) else ""),
            "observation", "high" if ind.amounts else "medium", evidence_ids[:2]))

    if ind.urgency:
        findings.append(_finding(
            f"It pressures you to act — the material says \"{ind.urgency[0]}\". Pressure to act fast is a common scam technique.",
            "observation", "medium", evidence_ids[:2]))

    if ind.phones:
        findings.append(_finding(
            f"The number shown is {ind.phones[0]}. A mobile number is not an official contact channel for a bank, government agency or toll operator.",
            "observation", "medium", evidence_ids[:2]))
    if ind.emails:
        domain = ind.emails[0].split("@")[-1]
        brand_match = any(_registrable(domain) == _registrable(official) for _, official in ind.brands)
        findings.append(_finding(
            f"The sender address is {ind.emails[0]}" + ("." if brand_match else f" — the domain {domain} is not an official address for the organisation it claims to be."),
            "observation", "high" if (ind.brands and not brand_match) else "medium", evidence_ids[:2]))

    images = [b for b in blocks if b.kind == "image"]
    if images and not text_blocks:
        findings.append(_finding(
            f"{len(images)} image{'s were' if len(images) > 1 else ' was'} submitted. No readable text accompanied it, so this result rests on the image alone.",
            "observation", "low", all_ids[:2]))

    if not findings:
        findings.append(_finding(
            "Nothing in the submitted material asks for money, credentials or urgent action, and no link was found in it.",
            "observation" if evidence_ids else "inference", "medium", evidence_ids[:2]))

    # Severity follows what was found — never a fixed level.
    serious = bool(ind.mismatched or ind.credentials
                   or (ind.payments and ind.urgency)
                   or any(p in ("gift card", "voucher", "itunes", "bitcoin", "crypto", "steam card") for p in ind.payments))
    watchful = bool(ind.hosts or ind.urgency or ind.payments or ind.phones or ind.emails)

    subject = (ind.brands[0][0] if ind.brands else None)
    host_phrase = ind.mismatched[0][2] if ind.mismatched else (ind.hosts[0] if ind.hosts else None)

    if serious:
        assessment, attention = "concern_found", "action_needed"
        overview = (
            f"This looks like a {subject} impersonation attempt." if subject and ind.mismatched
            else "This asks for information a genuine organisation would never request this way." if ind.credentials
            else "This pushes you to pay quickly, which is how scam demands work."
        )
        if host_phrase:
            overview += f" The link goes to {host_phrase}."
        if ind.credentials:
            overview += f" It asks for {ind.credentials[0]}."
        overview += " Don't use the link or give anything out — check with the organisation yourself."
        attention_reason = findings[0]["text"]
        if host_phrase:
            actions.append(_action("Don't open the link", f"Do not open {host_phrase} and do not enter any details on it."))
        if subject:
            actions.append(_action(f"Contact {subject} yourself", f"Contact {subject} using the number on your card, your statement or their official app — not any number or link in this material."))
        else:
            actions.append(_action("Verify independently", "Contact the organisation using contact details you already have, not the ones in this material."))
        if ind.credentials:
            actions.append(_action("Change it if you entered it", f"If you already gave {ind.credentials[0]}, change it now and tell your bank."))
    elif watchful:
        assessment, attention = "uncertain", "review"
        overview = "Nothing here proves a scam, but it can't be confirmed as genuine either."
        if host_phrase:
            overview += f" It contains the link {host_phrase}, and who operates it isn't established by this material."
        overview += " Treat it as unverified until you've checked with the organisation directly."
        attention_reason = findings[0]["text"]
        actions.append(_action("Check before acting", "Confirm this with the organisation using contact details you already have before clicking anything or replying."))
    else:
        assessment, attention = "no_concern_found_within_scope", "none"
        overview = ("Nothing in this material asks for money, credentials or urgent action, and it contains no link. "
                    "Nothing here needs action — this covers only what was submitted.")
        attention_reason = None

    uncertainties: list[str] = []
    if ind.hosts:
        uncertainties.append(f"Whether {ind.hosts[0]} is currently live or what it serves was not opened or fetched in this investigation.")
    if ind.phones:
        uncertainties.append(f"Whether {ind.phones[0]} belongs to the organisation named cannot be established from this material.")
    if ind.brands:
        uncertainties.append(f"Whether {ind.brands[0][0]} actually sent this can only be settled by contacting them directly.")
    if not uncertainties:
        uncertainties.append("Anything outside the submitted material — earlier messages, the sender's history, the account itself — was not examined.")

    detail_lines = [f"- {line}" for line in [f["text"] for f in findings]]
    todo_lines = [f"- {a['instruction']}" for a in actions] or ["- Nothing to do."]
    explanation = "\n".join([
        f"**{overview}**",
        "",
        "**What the evidence shows**",
        *detail_lines,
        "",
        "**What isn't settled**",
        *[f"- {u}" for u in uncertainties],
        "",
        "**What to do**",
        *todo_lines,
    ])

    return {
        "overview": overview[:900],
        "explanationMarkdown": explanation,
        "assessment": assessment,
        "attention": attention,
        "attentionReason": attention_reason,
        "findings": findings[:8],
        "uncertainties": uncertainties[:4],
        "scope": "Examined: " + ("; ".join(examined[:8]) if examined else "the submitted material")
                 + ". No website was opened, no sender was contacted and no account was accessed.",
        "sourceIds": [],
        "remainingEvidenceIds": [],
        "actions": actions,
        "recommendedActionIndex": 0 if actions else None,
        "question": None,
        "completion": "complete",
    }
