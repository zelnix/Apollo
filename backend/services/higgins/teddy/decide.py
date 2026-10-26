"""The deciding test — is the case resolved at TC FlyBy, or could Magnum DI change the result?

    Could deeper Magnum DI investigation or reasoning change Apollo's finding or Higgins' action?
        NO  → TC FlyBy resolves the case. "Unable to determine" is a valid finished outcome.
        YES → only the unresolved element, with the minimum context it needs, goes to Magnum DI.

No input format, case category or uncertainty sends a case to Magnum DI by itself. A screenshot or document
is investigated through the content Higgins Triage extracted from it, like any text. Magnum DI's additional
capabilities, and the only situations in which they can change the result:

    reading   — content Triage couldn't extract (Magnum DI reads images and pages directly), when nothing
                already established settles what to do;
    reasoning — the wording and tactics of a message that asks for something consequential (money,
                credentials, personal details, remote access, changed payment details, gift cards or crypto,
                a call-back on an organisation's behalf) through a route no official source verified, when
                nothing established settles it;
    relating  — a contradiction whose explanation could reverse the finding: a register entry under a
                related-but-different name; an organisation named beside a link or address that isn't its own
                with nothing else to go on; a scam pattern's wording beside the organisation's genuine links
                when the request still goes somewhere unverified.

Within the concern outcomes (Concerning, Likely scam, Confirmed scam or threat) Higgins' action is the same
protective one, so Magnum DI is never called to move a case between them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.higgins.brand_domains import registrable
from services.higgins.teddy.triage import CONSEQUENTIAL, Check, Plan, digits


@dataclass
class Decision:
    answered_by: str
    outcome: str | None        # Apollo's case outcome (outcomes.py); None for a general question
    basis: str                 # threat | pattern | impersonation | signals | clear | unknown | knowledge


@dataclass
class Issue:
    """One element only Magnum DI could settle, and the evidence items it needs to see for it."""
    capability: str            # reading | reasoning | relating
    text: str
    evidence_ids: list[str] = field(default_factory=list)
    check_id: str | None = None   # the planned check this settles, when there is one

    def wire(self) -> dict:
        return {"capability": self.capability, "text": self.text, "evidenceIds": self.evidence_ids, "checkId": self.check_id}


def _live(plan_: Plan) -> list[tuple[Check, dict]]:
    return [(c, f) for c in plan_.checks for f in c.facts if f["class"] == "live_evidence"]


def _ambiguous(f: dict) -> bool:
    """An organisation's name merely mentioned beside a link or address that isn't its own: on its own it could be
    a news link or someone's personal email, so it needs corroboration before it establishes anything. (An address
    that carries the organisation's name itself — a lookalike — is a warning sign without it.)"""
    return f.get("topic") in ("impersonation", "freemail")


def corroborated_impersonation(plan_: Plan) -> list[dict]:
    """The material names an organisation, a link in it isn't that organisation's own (not one of its published
    domains or country sites), and an independent fact about that same link backs it up (newly registered,
    flagged, redirected to another site, a direct download)."""
    mismatched = [f for c in plan_.checks if c.kind == "impersonation" for f in c.facts
                  if f.get("topic") in ("impersonation", "lookalike", "shared_service")]
    places = {registrable(f["place"]) for f in mismatched if f.get("place")}
    support = [f for c in plan_.checks if c.kind == "link" and registrable(c.subject) in places
               for f in c.facts if f["class"] == "live_evidence" and f["signal"] in ("anomaly", "concern")]
    return mismatched + support if support else []


def official_routes(plan_: Plan) -> bool:
    """Every link and address in the material belongs to the organisation it names."""
    impersonation = [c for c in plan_.checks if c.kind == "impersonation"]
    return bool(impersonation) and all(c.status == "resolved" and not any(f["signal"] == "anomaly" for f in c.facts) for c in impersonation)


def signals(plan_: Plan) -> list[tuple[Check, dict]]:
    """Warning signs the evidence establishes, whatever the input was. A name merely mentioned beside another
    organisation's address counts once something independent backs it up."""
    corroborated = bool(corroborated_impersonation(plan_))
    return [(c, f) for c, f in _live(plan_) if f["signal"] in ("concern", "anomaly") and (corroborated or not _ambiguous(f))]


def _route(checks: list[Check]) -> str:
    routes = {c.route for c in checks if c.route}
    if "google_search" in routes:
        return "teddy_search"
    return "teddy_kb" if routes == {"apollo_kb"} else "teddy_official"


def _contradicted(plan_: Plan) -> bool:
    p = plan_.pattern
    return bool(p and p["impersonatesOrganisation"] and plan_.entities.brands and official_routes(plan_))


def provisional(plan_: Plan) -> Decision | None:
    """The concern outcome the established evidence already supports, if any."""
    for c, f in _live(plan_):
        if f["signal"] == "concern" and f["decisive"]:
            return Decision("teddy_search" if c.route == "google_search" else "teddy_official", "confirmed_threat", "threat")
    p = plan_.pattern
    if p and p["stage"] == "full" and not _contradicted(plan_):
        return Decision("teddy_kb", "likely_scam", "pattern")
    if corroborated_impersonation(plan_):
        return Decision("teddy_official", "concerning", "impersonation")
    if p and p["stage"] == "opening" and not _contradicted(plan_):
        return Decision("teddy_kb", "concerning", "pattern")
    found = signals(plan_)
    if found:
        return Decision(_route([c for c, _ in found]), "concerning", "signals")
    return None


def verified(target: str, plan_: Plan) -> bool:
    """An official source established that this route belongs to the organisation: an official domain, an
    official email domain, or a number a search confirmed as an official contact."""
    low = target.lower()
    for c in plan_.checks:
        if c.kind == "link" and c.subject in low:
            return any(f["decisive"] and f["signal"] == "clear" for f in c.facts)
        if c.kind == "email" and c.subject.lower() == low:
            return any(f["signal"] == "clear" for f in c.facts)
        if c.kind == "phone" and digits(c.subject)[-8:] and digits(c.subject)[-8:] == digits(target)[-8:]:
            return any(f["signal"] == "clear" for f in c.facts)
    return False   # payment details and anything unchecked can't be verified


def unverified_requests(plan_: Plan) -> list[dict]:
    """Consequential requests whose routes aren't all verified as official."""
    out = []
    for r in plan_.entities.requests:
        consequential = r["type"] in CONSEQUENTIAL or (r["type"] == "call_back" and bool(plan_.entities.brands))
        if consequential and not (r["targets"] and all(verified(t, plan_) for t in r["targets"])):
            out.append(r)
    return out


def _ids_with(texts: dict[str, str], needles: list[str]) -> list[str]:
    low = [n.lower() for n in needles if n]
    return [eid for eid, text in texts.items() if any(n in text.lower() for n in low)] or list(texts)[:2]


def magnum_issues(plan_: Plan, texts: dict[str, str]) -> list[Issue]:
    """With nothing established that settles the case: what Magnum DI's extra capabilities could still change."""
    issues = [Issue("reading", f"Read {g['item']} directly — {g['what']}.", [g["evidenceId"]]) for g in plan_.gaps if g.get("magnum")]
    requests = unverified_requests(plan_)
    if plan_.has_message and requests:
        asks = "; ".join(f"{r['type'].replace('_', ' ')} (“{r['quote']}”" + (f" → {', '.join(r['targets'][:3])}" if r["targets"] else "") + ")"
                         for r in requests[:4])
        partly = (f" ApolloSG KB: the material partly matches the {plan_.pattern['name']} ({plan_.pattern['publisher']}), general knowledge only."
                  if plan_.pattern and plan_.pattern["stage"] == "partial" else "")
        analysis = next((c.id for c in plan_.checks if c.kind == "message_analysis"), None)
        issues.append(Issue("reasoning", f"Message and deception analysis. The material asks the person to act — {asks} — through a route "
                                         f"no official source verified, and nothing TC FlyBy established settles what to do.{partly}", list(texts), analysis))
    for c in plan_.checks:
        if c.open_issue.startswith("Conflict"):
            issues.append(Issue("relating", c.open_issue, _ids_with(texts, plan_.entities.companies + [c.subject]), c.id))
    for c, f in _live(plan_):
        if _ambiguous(f) and f["signal"] == "anomaly":
            issues.append(Issue("relating", f"Whether the material genuinely comes from the organisation it names: {f['text']}",
                                _ids_with(texts, [f.get("place") or c.subject]), c.id))
    p = plan_.pattern
    if p and p["stage"] in ("full", "opening") and _contradicted(plan_) and requests:
        pattern_check = next((c.id for c in plan_.checks if c.kind == "scam_pattern"), None)
        issues.append(Issue("relating", f"The wording matches the {p['name']} ({p['publisher']}), yet the links and addresses are the "
                                        "organisation's own: whether the conflicting indicators change the finding.", list(texts), pattern_check))
    return issues


def _complete(plan_: Plan) -> bool:
    """Every planned check that bears on the outcome actually ran over everything submitted: nothing left
    unextracted, no lookup unavailable, and each link either an official domain or both listed-clean and of
    established registration."""
    if plan_.gaps or any(c.status == "unavailable" for c in plan_.checks):
        return False
    for c in plan_.checks:
        if c.kind != "link" or any(f["decisive"] and f["signal"] == "clear" for f in c.facts):
            continue
        topics = {f.get("topic"): f["signal"] for f in c.facts}
        if not (topics.get("listing") == "clear" and topics.get("registration") == "neutral"):
            return False
    return True


def evaluate(plan_: Plan, texts: dict[str, str], *, final: bool) -> tuple[Decision | None, list[Issue]]:
    """(TC FlyBy's decision, []) when the case is resolved; (None, issues) when Magnum DI could change it.
    Before the last stage only a decisive official result (or an answered general question) stops TC FlyBy —
    every other outcome waits until the checks Higgins Triage planned have run."""
    found = provisional(plan_)
    if found and found.outcome == "confirmed_threat":
        return found, []
    if plan_.general:
        check = plan_.checks[0]
        if check.status == "resolved":
            return Decision("teddy_kb" if check.route == "apollo_kb" else "teddy_search", None, "knowledge"), []
        return None, ([Issue("reasoning", f"Answer the general question: {check.subject}", list(texts), check.id)] if final else [])
    if not final:
        return None, []
    if found:
        return found, []           # a concern outcome: the protective action stands whatever Magnum DI found
    issues = magnum_issues(plan_, texts)
    if issues:
        return None, issues
    route = _route(plan_.checks)
    if _complete(plan_):
        return Decision(route, "no_scam_indicators", "clear"), []
    return Decision(route, "unable_to_determine", "unknown"), []


def magnum_needs_search(plan_: Plan, issues: list[Issue]) -> bool:
    """Google Search stays OFF for Magnum DI unless a specific external fact may still be missing: content it
    will read for the first time, a lookup that was unavailable, or a general question Teddy couldn't answer."""
    return bool(any(i.capability == "reading" for i in issues) or any(c.status == "unavailable" for c in plan_.checks) or plan_.general)
