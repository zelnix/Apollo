"""Higgins Plain-English Renderer, step 1: the authoritative findings, in structured form.

Built only from the validated result (TC FlyBy's or Magnum DI's) and the case's own records: Apollo's routing
(what Higgins Triage and TC FlyBy did, what Magnum DI was sent) and the registered sources. Nothing is
recomputed, re-scored or reinterpreted here. The renderer explains these facts; the Fidelity Check compares its
wording against them; where the two ever differ, these facts win.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from services.higgins import outcomes
from services.higgins.contracts import HigginsResponse
from services.higgins.teddy.report import ROUTE_LABEL

# ── Words and sentences ──────────────────────────────────────────────────────
STOP = set(("a an the this that these those it its it's is are was were be been being so to of on in at or and but with for by as "
            "from your you there there's here what which who how would will can could has have had do does did if then than also just "
            "into about").split())
_WORD = re.compile(r"[a-z0-9']+")


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace("’", "'").replace("‘", "'"))


def normal(text: str) -> str:
    return " ".join(words(text))


def _stem(w: str) -> str:
    w = re.sub(r"'s$", "", w)
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def meaning(text: str) -> set[str]:
    return {_stem(w) for w in words(text) if w not in STOP}


def negated(m: set[str]) -> bool:
    return any(w in ("not", "no", "never") or w.endswith("n't") for w in m)


def same_meaning(a: str, b: str) -> bool:
    """The same point in other words: three quarters of `a`'s meaningful words are in `b`, with the same yes-or-no."""
    ma, mb = meaning(a), meaning(b)
    return len(ma) >= 4 and len(ma & mb) / len(ma) >= 0.75 and negated(ma) == negated(mb)


def sentences(text: str) -> list[str]:
    """Split only where . ! ? is followed by a space, so example.com.au and $3.20 stay whole."""
    out, start = [], 0
    for i, ch in enumerate(text):
        if ch in ".!?" and (i + 1 == len(text) or text[i + 1].isspace()):
            out.append(text[start:i + 1].strip())
            start = i + 1
    rest = text[start:].strip()
    if rest:
        out.append(rest)
    return [s for s in out if s]


def strip_markdown(text: str) -> str:
    text = re.sub(r"^#{1,6}\s*", "", text.strip())
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    text = re.sub(r"\[(.+?)\]\((https?:[^)]+)\)", r"\1 (\2)", text)
    return re.sub(r"^[-*•]\s+", "", text).strip()


# ── Identifiers that must survive word for word ──────────────────────────────
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
ENTITY_PATTERNS: dict[str, re.Pattern] = {
    "url": re.compile(r"\bhttps?://[^\s<>\"')\]]+", re.I),
    "email": re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"),
    "domain": re.compile(r"(?<![@\w/.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b(?![@\w-])", re.I),
    "registration": re.compile(r"\b(?:ABN|ACN|ARBN|AFSL|ACL|licen[cs]e(?: number| no\.?)?|registration(?: number| no\.?)?)\s*:?\s*\d[\d ]{4,14}\d\b", re.I),
    "phone": re.compile(r"(?<![\w$.])\+?\d[\d ()-]{6,16}\d(?![\w.%])"),
    "money": re.compile(r"(?:A?\$|AUD ?|USD ?|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|billion)\b)?", re.I),
    "percent": re.compile(r"\b\d+(?:\.\d+)?\s?(?:%|per ?cent\b)", re.I),
    "date": re.compile(rf"\b\d{{4}}-\d{{2}}-\d{{2}}\b|\b\d{{1,2}} {_MONTH} \d{{4}}\b|\b{_MONTH} \d{{1,2}},? \d{{4}}\b|\b\d{{1,2}}/\d{{1,2}}/\d{{2,4}}\b", re.I),
    "duration": re.compile(r"\b\d+(?:\.\d+)? (?:days?|weeks?|months?|years?|hours?|minutes?)\b", re.I),
}


def _norm_entity(kind: str, value: str) -> str:
    value = value.strip().rstrip(".,;:!?").lower()
    if kind == "url":
        value = value.rstrip("/")
    if kind in ("phone", "registration"):
        value = re.sub(r"[\s()-]", "", value)
    return value


def entities(text: str) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for kind, pattern in ENTITY_PATTERNS.items():
        for m in pattern.finditer(text):
            value = _norm_entity(kind, m.group(0))
            if kind == "phone" and not 8 <= len(re.sub(r"\D", "", value)) <= 15:
                continue
            if kind == "domain" and re.fullmatch(r"[\d.]+", value):
                continue
            if value:
                found.setdefault(kind, set()).add(value)
    # A URL's own host is part of the URL, not a separate identifier to restate.
    return found


def entity_text(text: str) -> str:
    """Text normalised the way entities are, so a preserved identifier can be found inside it."""
    return text.lower().replace("’", "'")


# ── The authoritative findings ───────────────────────────────────────────────
CONTRAST = re.compile(r"\b(but|however|although|though|whereas|contradict\w*|inconsistent|doesn't match|does not match|don't match|differ\w*|unlike)\b", re.I)
_FOUND = re.compile(r"^what (was|apollo|tc flyby|magnum di) found", re.I)
_HOW = re.compile(r"^how apollo (checked|answered)", re.I)
_MEANS = re.compile(r"^what it means", re.I)
AUTHORITY = {"official": "official source", "independent": "independent source",
             "self_claimed": "the destination's own page, not independent", "unknown": "search result, publisher not independently verified"}


def investigator(answered_by: Optional[str]) -> str:
    return "TC FlyBy" if str(answered_by or "").startswith("teddy") else "Magnum DI"


def _blocks(markdown: str) -> list[tuple[Optional[str], list[str]]]:
    """The explanation's own sections: a "## Title" or "**Title**" line starts one."""
    out: list[tuple[Optional[str], list[str]]] = [(None, [])]
    for raw in markdown.split("\n"):
        m = re.match(r"^\s*(?:#{1,6}\s+(.+?)|\*\*(.+?)\*\*\s*(.*))\s*$", raw)
        if m and (m.group(1) or (m.group(2) and not re.search(r"[.!?]$", m.group(2)))):
            out.append((strip_markdown(m.group(1) or m.group(2)), [strip_markdown(m.group(3))] if m.group(3) else []))
        elif raw.strip():
            out[-1][1].append(strip_markdown(raw))
    return [(t, [line for line in lines if line]) for t, lines in out if t or lines]


@dataclass
class Facts:
    by: str
    revision: int
    outcome: Optional[str]
    assessment: str
    attention: str
    completion: str
    verdict: list[str]
    findings: list[dict]
    meaning: list[tuple[Optional[str], str]]
    method: list[str]
    attention_reason: Optional[str]
    uncertainties: list[str]
    scope: str
    remaining: int
    recommended: Optional[dict]
    other_actions: list[dict]
    actions: list[dict]
    sources: list[dict]
    triaged: bool
    flyby_routes: list[str]
    magnum: Optional[dict]
    # Every authoritative sentence of "How Apollo checked" and the scope, once.
    how: list[str] = field(default_factory=list)
    # The result's own words (no sources), and the same with the sources it relied on.
    core: str = ""
    corpus: str = ""
    # Identifiers the plain English must keep (from the result's own words), and those it may show (also the sources).
    entities: dict[str, set[str]] = field(default_factory=dict)
    allowed: dict[str, set[str]] = field(default_factory=dict)
    contradictions: list[str] = field(default_factory=list)

    def structure(self) -> dict[str, Any]:
        """The authoritative findings in Apollo's conceptual schema (finding / triage / flyby / investigation / ...)."""
        return {
            "finding": {"verdict": self.verdict, "classification": self.outcome, "assessment": self.assessment, "severity": self.attention,
                        "confidence": [f["confidence"] for f in self.findings]},
            "triage": {"ran": self.triaged}, "flyby": {"routes": self.flyby_routes},
            "investigation": {"by": self.by, "findings": self.findings, "meaning": [p for _, p in self.meaning], "method": self.method,
                              "contradictions": self.contradictions, "magnum": self.magnum},
            "entities": {k: sorted(v) for k, v in self.entities.items()},
            "evidence": {"authoritative_sources": self.sources},
            "uncertainty": {"unknowns": self.uncertainties, "scope": self.scope, "completion": self.completion, "unexamined": self.remaining},
            "guidance": {"recommended_action": self.recommended, "other_actions": self.other_actions, "urgency": self.attention},
            "renderer_constraints": {"must_preserve": sorted(v for vals in self.entities.values() for v in vals),
                                     "must_not_infer": ["classification", "severity", "confidence", "recommended action", "urgency", "attribution"]},
        }


def build(response: HigginsResponse, *, answered_by: Optional[str], routing: dict, sources: list[dict]) -> Facts:
    by = investigator(answered_by)
    findings = [{"id": f.id, "text": strip_markdown(f.text), "basis": f.basis, "confidence": f.confidence, "sourceIds": list(f.source_ids)}
                for f in response.findings]
    meaning_paras: list[tuple[Optional[str], str]] = []
    method: list[str] = []
    finding_norms = [normal(f["text"]) for f in findings]
    for title, lines in _blocks(response.explanation_markdown or ""):
        if title and _HOW.search(title):
            method += [s for line in lines for s in sentences(line)]
        elif title and _FOUND.search(title):
            # A "what was found" line that isn't one of the structured findings is still a fact: kept as meaning.
            meaning_paras += [(None, line) for line in lines if not any(normal(line) in fn or fn in normal(line) for fn in finding_norms)]
        else:
            if title and lines and re.fullmatch(r"\(.+\)", lines[0]):
                # "**What Apollo's knowledge base adds** (general knowledge, not evidence …)": the caveat belongs to the title.
                title, lines = f"{title} {lines[0]}", lines[1:]
            meaning_paras += [(None if not title or _MEANS.search(title) else title, line) for line in lines]
    actions = [{"id": a.id, "label": strip_markdown(a.label), "instruction": strip_markdown(a.instruction)} for a in response.actions]
    recommended = next((a for a in actions if a["id"] == response.recommended_action_id), actions[0] if actions else None)
    used = set(response.source_ids)
    relied = [{"id": s.get("id"), "title": s.get("title") or s.get("url"), "url": s.get("url"), "authority": s.get("authority", "unknown"),
               "retrieval": s.get("retrieval")} for s in sources if s.get("id") in used]
    teddy = routing.get("teddy") or {}
    routes = []
    for check in teddy.get("checks") or []:
        label = ROUTE_LABEL.get(check.get("route") or "")
        if label and label not in routes:
            routes.append(label)
    facts = Facts(
        by=by, revision=response.revision, outcome=response.outcome, assessment=response.assessment, attention=response.attention,
        completion=response.completion, verdict=[s for p in (response.overview or "").split("\n") for s in sentences(strip_markdown(p))],
        findings=findings, meaning=meaning_paras, method=method,
        attention_reason=strip_markdown(response.attention_reason) if response.attention_reason else None,
        uncertainties=[strip_markdown(u) for u in response.uncertainties if u.strip()], scope=strip_markdown(response.scope or ""),
        remaining=len(response.remaining_evidence_ids), recommended=recommended,
        other_actions=[a for a in actions if a is not recommended], actions=actions, sources=relied,
        triaged=bool(teddy) and response.revision == 1, flyby_routes=routes if response.revision == 1 else [],
        magnum=routing.get("magnum") if by == "Magnum DI" and response.revision == 1 else None,
    )
    for s in method + sentences(facts.scope):
        if normal(s) not in {normal(h) for h in facts.how}:
            facts.how.append(s)
    authoritative = (facts.verdict + [f["text"] for f in findings] + [p for _, p in meaning_paras] + [t for t, _ in meaning_paras if t]
                     + method + facts.uncertainties + [facts.scope, facts.attention_reason or ""]
                     + [f"{a['label']} {a['instruction']}" for a in actions] + routes + [outcomes.LABELS.get(facts.outcome or "", "")])
    facts.core = "\n".join(t for t in authoritative if t)
    facts.corpus = "\n".join([facts.core, *(f"{s['title']} {s['url']}" for s in relied)])
    facts.entities = entities(facts.core)
    facts.allowed = entities(facts.corpus)
    facts.contradictions = [s for text in (facts.verdict + [f["text"] for f in findings] + [p for _, p in meaning_paras] + facts.uncertainties)
                            for s in sentences(text) if CONTRAST.search(s)]
    return facts
