"""Apollo's own plain words: the only wording the Plain-English Renderer may add to a validated result.

Everything else it shows is the result's own wording. These lists are fixed: nothing here is generated, and the
Fidelity Check holds the renderer to them.
"""
from __future__ import annotations

import re

# Formal → plain. Swaps that change the words but never what is said, how sure it is or how serious it is.
PLAIN_SWAPS: tuple[tuple[str, str], ...] = (
    ("in order to", "to"), ("prior to", "before"), ("approximately", "about"),
    ("utilised", "used"), ("utilized", "used"), ("utilising", "using"), ("utilizing", "using"),
    ("utilises", "uses"), ("utilizes", "uses"), ("utilise", "use"), ("utilize", "use"),
    ("commenced", "started"), ("commences", "starts"), ("commence", "start"),
    ("insufficient", "not enough"), ("sufficient", "enough"), ("additional", "more"),
    ("obtained", "got"), ("obtain", "get"), ("assistance", "help"), ("regarding", "about"), ("numerous", "many"),
    ("subsequently", "later"), ("furthermore", "also"), ("moreover", "also"), ("additionally", "also"),
    ("nevertheless", "still"), ("nonetheless", "still"),
    ("indicates", "shows"), ("indicated", "showed"), ("indicating", "showing"), ("indicate", "show"),
    ("demonstrates", "shows"), ("demonstrated", "showed"),
    ("attempts to", "tries to"), ("attempted to", "tried to"), ("attempt to", "try to"),
    ("is unable to", "can't"), ("are unable to", "can't"), ("was unable to", "couldn't"), ("were unable to", "couldn't"),
    ("cannot", "can't"), ("can not", "can't"),
    ("do not", "don't"), ("does not", "doesn't"), ("did not", "didn't"), ("is not", "isn't"), ("are not", "aren't"),
    ("was not", "wasn't"), ("were not", "weren't"), ("has not", "hasn't"), ("have not", "haven't"), ("had not", "hadn't"),
    ("could not", "couldn't"), ("would not", "wouldn't"), ("should not", "shouldn't"), ("will not", "won't"),
)
_SWAP_RE = [(re.compile(rf"\b{re.escape(formal)}\b", re.I), plain) for formal, plain in PLAIN_SWAPS]


def swap(text: str) -> str:
    """Apply the plain swaps, keeping a capital first letter where the original had one."""
    for pattern, plain in _SWAP_RE:
        text = pattern.sub(lambda m, p=plain: p[0].upper() + p[1:] if m.group(0)[0].isupper() else p, text)
    return text


# Jargon, explained once per result in Apollo's own fixed words. Explanatory only, never case evidence.
GLOSSARY: tuple[tuple[str, str, str], ...] = (
    ("registration record", r"\b(?:registration record|RDAP|registrar|registered (?:less than|\d+|on|in)|newly registered)\b",
     "A web address's registration record is the public record of when it was set up and who it was registered through."),
    ("domain", r"\bdomains?\b", "A domain is the name part of a web or email address, the part that says who runs it."),
    ("phishing", r"\bphishing\b", "Phishing is a fake message or website made to trick you into handing over passwords, codes or money."),
    ("malware", r"\bmalware\b", "Malware is software made to harm your phone or steal from it."),
    ("redirect", r"\bredirect(?:s|ed|ing)?\b", "A redirect sends you on from the address you tapped to a different one."),
    ("Safe Browsing", r"\bSafe Browsing\b", "Google Safe Browsing is Google's list of websites known to be harmful."),
    ("IPQualityScore", r"\b(?:IPQualityScore|IPQS|fraud score)\b",
     "IPQualityScore rates how risky a link or phone number looks. Its score is a likelihood, not proof."),
    ("blocklist", r"\bblocklist(?:ed)?\b", "A blocklist is a list of addresses already known to be harmful."),
    ("VoIP", r"\bVoIP\b", "A VoIP number runs over the internet, and anyone can set one up in minutes."),
    ("ABN", r"\bA[BC]N\b", "An ABN or ACN is the public number of a business registered in Australia."),
    ("ASIC", r"\bASIC\b", "ASIC is Australia's company regulator. Its registers list companies and licence holders."),
    ("AFSL", r"\bAFSL\b", "An AFSL is the licence a business needs in Australia to sell investments or give financial advice."),
    ("PayID", r"\bPayID\b", "PayID sends a bank payment to a phone number or email address instead of account details."),
    ("impersonation", r"\bimpersonat\w*", "Impersonation means pretending to be a real person or organisation."),
    ("lookalike", r"\blook-?alike\b", "A lookalike address copies a real organisation's name with small changes."),
    ("one-time code", r"\b(?:one-time|verification|security) codes?\b", "A one-time code is the short code a service sends to prove it's you."),
    ("remote access", r"\bremote(?:-| )access\b", "Remote access lets someone else control your phone or computer from somewhere else."),
    ("spoofing", r"\bspoof\w*", "Spoofing makes a call or message look like it comes from someone it doesn't."),
    ("cryptocurrency", r"\bcrypto(?:currency|currencies)?\b", "A cryptocurrency payment is very hard to trace or get back."),
)
GLOSSARY_TEXTS = frozenset(text for _, _, text in GLOSSARY)
_GLOSSARY_RE = [(term, re.compile(pattern, re.I), text) for term, pattern, text in GLOSSARY]


def jargon(text: str, explained: set[str]) -> str:
    """The first unexplained term in `text`, explained; '' when there is none. `explained` is updated."""
    for term, pattern, explanation in _GLOSSARY_RE:
        if term not in explained and pattern.search(text):
            explained.add(term)
            return explanation
    return ""


# How serious it is, in plain words: one fixed line per attention level, never anything else.
SEVERITY = {
    "none": "How serious: nothing needs doing.",
    "review": "How serious: worth a careful look before you act on it.",
    "action_needed": "How serious: you need to act. See what you can do.",
    "urgent": "How serious: urgent. Act now.",
}

# Who established a finding, and how firmly. {by} is TC FlyBy or Magnum DI.
BASIS = {"observation": "Seen directly by {by}", "user_report": "From what you told Apollo",
         "inference": "{by}'s reading of the evidence, not seen directly"}
CONFIDENCE = {"high": "High confidence", "medium": "Medium confidence", "low": "Low confidence"}


def detail(basis: str, confidence: str, by: str) -> str:
    return f"{BASIS[basis].format(by=by)} · {CONFIDENCE[confidence]}"


# Words the plain English may use no more often than Apollo's own wording does.
CERTAINTY = ("definitely", "certainly", "guaranteed", "proven", "proves", "100%", "without doubt", "no doubt", "for sure", "confirmed", "always")
SAFETY = ("safe", "safely", "genuine", "legitimate", "legit", "trustworthy", "harmless", "nothing to worry", "no need to worry", "don't worry", "fine")
SOFTENERS = ("probably", "just", "only", "minor", "slightly", "a little", "low risk", "unlikely", "maybe")
ESCALATORS = ("urgent", "urgently", "immediately", "dangerous", "emergency", "right now", "critical", "serious", "seriously")
