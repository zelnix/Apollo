"""What Higgins shows when Teddy DI settles a check, and the slice Magnum DI receives when it can't.

Higgins explains what was found → what it means → what to do. Every finding is live evidence about this
case, citing the Teddy DI evidence item and the source that established it. Apollo KB knowledge is never a
finding: it appears only as supporting context in the explanation. Anything Teddy could not establish stays
an uncertainty — missing evidence is never turned into a fact.
"""
from __future__ import annotations

import json

from services.higgins.teddy.triage import Check, Plan

ROUTE_LABEL = {"teddy_official": "official source checks", "teddy_kb": "Apollo's knowledge base", "teddy_search": "a targeted web search"}


def _finding(f: dict, evidence_ids: list[str], confidence: str) -> dict:
    return {"text": f["text"], "basis": "observation", "confidence": confidence, "evidenceIds": evidence_ids,
            "sourceIds": f.get("sourceIds") or [], "supersedesFindingIds": []}


def _action(label: str, instruction: str) -> dict:
    return {"kind": "instruction", "label": label, "instruction": instruction, "capabilityId": None, "sourceIds": [],
            "desiredField": None, "desiredValue": None}


def _live(checks: list[Check]) -> list[tuple[Check, dict]]:
    return [(c, f) for c in checks for f in c.facts if f.get("class") == "live_evidence" and f["signal"] != "missing"]


def _knowledge(checks: list[Check]) -> list[dict]:
    return [f for c in checks for f in c.facts if f.get("class") == "apollo_knowledge"]


def _missing(checks: list[Check], not_taken_further: str | None) -> list[str]:
    """What stays uncertain: lookups that found nothing or failed, and — when Teddy DI resolved the case —
    the open issues it didn't take further, with the reason."""
    out = [f["text"] for c in checks for f in c.facts if f["signal"] == "missing"]
    for c in checks:
        if c.status == "unavailable":
            out.append(f"{c.subject}: Teddy DI's lookup was unavailable, so this wasn't established either way.")
        elif c.status in ("open", "needs_reasoning") and not_taken_further and c.open_issue:
            out.append(f"Not taken further, because {not_taken_further}: {c.open_issue[0].lower()}{c.open_issue[1:]}")
    return out


def _knowledge_block(checks: list[Check]) -> str:
    notes = _knowledge(checks)
    if not notes:
        return ""
    lines = "\n".join(f"- {f['text']}" + (f" — {f['source']['url']}" if (f.get("source") or {}).get("url") else "") for f in notes[:4])
    return f"\n\n**What Apollo's knowledge base adds** (general knowledge, not evidence about what you sent)\n{lines}"


def _evidence_for(subject: str, material: dict[str, str], teddy_item: str) -> list[str]:
    """The Teddy DI record, plus the submitted item(s) the checked value actually appears in."""
    needle = subject.lower()
    return [teddy_item, *[eid for eid, text in material.items() if needle and needle in text.lower()][:2]]


def _evidence(c: Check, material: dict[str, str], teddy_item: str) -> list[str]:
    return _evidence_for(c.subject, material, teddy_item)


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}" if items else ""


def _routes(checks: list[Check]) -> str:
    used = {c.route for c in checks if c.route}
    names = [label for route, label in (("official_source", "official source checks"), ("apollo_kb", "Apollo's knowledge base"),
                                        ("google_search", "a targeted web search")) if route in used]
    return _join(names) or "official source checks"


def _scope(plan_: Plan, how: str) -> str:
    examined = "the submitted link" + ("s" if len(plan_.entities.hosts) > 1 else "") if plan_.link_only else "the submitted material"
    return (f"Teddy DI checked {examined} using {how}. Nothing was opened or fetched from the destination, no one was contacted "
            "and no account was accessed.")


def concern(plan_: Plan, checks: list[Check], material: dict[str, str], teddy_item: str, route: str, unread: list[str]) -> dict:
    decisive = [(c, f) for c, f in _live(checks) if f["decisive"] and f["signal"] == "concern"]
    lead_check, lead = decisive[0]
    brand = plan_.entities.brands[0][0] if plan_.entities.brands else None
    findings = [_finding(f, _evidence(c, material, teddy_item), "high") for c, f in decisive]
    findings += [_finding(f, _evidence(c, material, teddy_item), "medium") for c, f in _live(checks)
                 if f["signal"] in ("anomaly", "concern") and not f["decisive"]]
    kinds = {c.kind for c, _ in decisive}
    actions: list[dict] = []
    if "link" in kinds:
        actions.append(_action("Don't open the link", f"Don't open {lead_check.subject if lead_check.kind == 'link' else 'the link'} and don't enter anything on it."))
    if "phone" in kinds:
        actions.append(_action("Don't call or reply", "Don't call the number back or reply to it."))
    if "email" in kinds:
        actions.append(_action("Don't reply", "Don't reply to the email or open its attachments."))
    if "company" in kinds:
        actions.append(_action("Don't send money", "Don't invest, pay or send personal details to this company."))
    actions.append(_action(f"Contact {brand} yourself" if brand else "Check independently",
                           f"If you're unsure, contact {brand} using the number on your card, statement or their official app — not anything in this material."
                           if brand else "If you're unsure, contact the organisation using contact details you already have — not anything in this material."))
    actions.append(_action("Report it", "Report it to Scamwatch at scamwatch.gov.au. If you've already paid or shared details, contact your bank now."))
    means = ("An official safety source has already identified this as dangerous, so there's nothing left to weigh up: "
             "acting on it would put your money, accounts or device at risk.")
    found = "\n".join(f"- {f['text']}" for _, f in decisive)
    explanation = (f"**What was found**\n{found}\n\n**What it means**\n{means}{_knowledge_block(checks)}\n\n"
                   f"**How Apollo checked**\nTeddy DI settled this with {ROUTE_LABEL[route]}. Magnum DI's deeper analysis wasn't needed, "
                   "because the result above already settles what to do.")
    return {
        "overview": f"{lead['text']} Don't act on it" + (f" — if you need to, contact {brand} yourself." if brand else "."),
        "explanationMarkdown": explanation, "assessment": "concern_found", "outcome": "confirmed_threat", "attention": "action_needed",
        "attentionReason": "An official source has already identified it as dangerous, so acting on it puts your money or accounts at risk.",
        "findings": findings[:8], "uncertainties": _missing(checks, "the official result already settles what to do")[:4] or
        ["Anything outside the submitted material — earlier messages or the sender's history — wasn't examined."],
        "scope": _scope(plan_, ROUTE_LABEL[route]), "sourceIds": sorted({s for f in findings for s in f["sourceIds"]}),
        "remainingEvidenceIds": unread, "actions": actions, "recommendedActionIndex": 0, "question": None,
        "completion": "partial" if unread else "complete",
    }


def clear(plan_: Plan, checks: list[Check], material: dict[str, str], teddy_item: str, route: str) -> dict:
    facts = _live(checks)
    findings = [_finding(f, _evidence(c, material, teddy_item), "medium") for c, f in facts]
    hosts = ", ".join(plan_.entities.hosts[:3]) or "the link"
    official = next((f for _, f in facts if f["decisive"] and f["signal"] == "clear"), None)
    overview = (f"{official['text']} Nothing Apollo checked raises a concern, so nothing here needs action."
                if official else
                f"Nothing Apollo checked raises a concern about {hosts}. That isn't proof the site is safe — only that these checks found nothing.")
    found = "\n".join(f"- {f['text']}" for _, f in facts)
    explanation = (f"**What was found**\n{found}\n\n**What it means**\nThese checks look at who runs the address and whether any safety list or "
                   f"warning names it. They don't show what the page asks you to do, so still never enter passwords or codes on a page you reached "
                   f"from a message.{_knowledge_block(checks)}\n\n**How Apollo checked**\nTeddy DI settled this with {ROUTE_LABEL[route]}; "
                   "nothing in it needed Magnum DI's deeper analysis.")
    return {
        "overview": overview, "explanationMarkdown": explanation, "assessment": "no_concern_found_within_scope", "outcome": "no_scam_indicators",
        "attention": "none", "attentionReason": None, "findings": findings[:8],
        "uncertainties": (_missing(checks, None) + ["Apollo didn't open the page, so what it shows or asks for wasn't checked."])[:4],
        "scope": _scope(plan_, ROUTE_LABEL[route]), "sourceIds": sorted({s for f in findings for s in f["sourceIds"]}),
        "remainingEvidenceIds": [], "actions": [], "recommendedActionIndex": None, "question": None, "completion": "complete",
    }


_CHECK_FIRST = "If you need the organisation, go to it through its official app or a website address you type yourself."
_NOT_NEEDED = "Magnum DI's deeper analysis wasn't needed, because it couldn't change the outcome or what to do."


def _result(plan_: Plan, checks: list[Check], *, overview: str, found: list[dict], means: str, how: str, outcome: str, attention: str,
            reason: str | None, actions: list[dict], uncertainties: list[str], extra_sources: list[str] = ()) -> dict:
    from services.higgins import outcomes
    lines = "\n".join(f"- {f['text']}" for f in found) or "- Nothing beyond what's listed under what isn't certain."
    return {
        "overview": overview[:900],
        "explanationMarkdown": f"**What was found**\n{lines}\n\n**What it means**\n{means}{_knowledge_block(checks)}\n\n**How Apollo checked**\n{how}",
        "assessment": outcomes.ASSESSMENT[outcome], "outcome": outcome, "attention": attention, "attentionReason": reason,
        "findings": found[:8], "uncertainties": uncertainties[:4], "scope": _scope(plan_, _routes(checks)),
        "sourceIds": sorted({*extra_sources, *(s for f in found for s in f["sourceIds"])}), "remainingEvidenceIds": [],
        "actions": actions, "recommendedActionIndex": 0 if actions else None, "question": None, "completion": "complete",
    }


def pattern_result(plan_: Plan, checks: list[Check], material: dict[str, str], teddy_item: str, outcome: str) -> dict:
    """The material matches an established scam pattern in Apollo's KB. The material's own words are the
    findings; the pattern is general knowledge that supports the assessment — never proof about the sender."""
    p = plan_.pattern
    items = list(material)[:2]
    quoted = [*p["found"], *([p["ask"]] if p["ask"] else [])]
    found = [{"text": f"It {label}: “{quote}”.", "basis": "observation", "confidence": "high", "evidenceIds": items, "sourceIds": [],
              "supersedesFindingIds": []} for label, quote in quoted]
    found += [_finding(f, _evidence(c, material, teddy_item), "medium") for c, f in _live(checks) if f["signal"] in ("anomaly", "concern")]
    kb_sources = sorted({s for c in checks if c.kind == "scam_pattern" for f in c.facts for s in f.get("sourceIds", [])})
    advice = p["advice"]
    if outcome == "likely_scam":
        overview = f"This matches the {p['name']} that {p['publisher']} warns about. {advice[0][1]} {advice[1][1]}"
        means = (f"Together, these are the defining features of the {p['name']}: {p['summary']} A match like this supports Apollo's "
                 "assessment, but it isn't proof that this particular sender is a scammer — which is why the safe step is to check through "
                 "a channel you already trust.")
        attention, reason = "action_needed", p["consequence"]
    else:
        overview = (f"This starts the way the {p['name']} does, as {p['publisher']} describes it, though it hasn't asked for anything yet. "
                    f"Before you reply: {advice[1][1][0].lower()}{advice[1][1][1:]}")
        means = (f"Scams like this often begin exactly this way: {p['summary']} Nothing has been asked for yet, so it could still be genuine — "
                 "but checking first costs nothing.")
        attention, reason = "review", "Replying or acting before you've checked is what messages like this rely on."
    return _result(plan_, checks, overview=overview, found=found, means=means, outcome=outcome, attention=attention, reason=reason,
                   how=f"Teddy DI checked the material using {_routes(checks)}, comparing it with the established scam patterns in Apollo's "
                       f"knowledge base. {_NOT_NEEDED}",
                   actions=[_action(label, instruction) for label, instruction in advice],
                   uncertainties=["Apollo can't confirm who actually sent this — a pattern match supports the assessment but isn't proof about the sender.",
                                  *_missing(checks, "it couldn't change the outcome or what to do")],
                   extra_sources=kb_sources)


def impersonation_result(plan_: Plan, checks: list[Check], material: dict[str, str], teddy_item: str, facts: list[dict]) -> dict:
    """The material borrows an organisation's name, its link goes elsewhere, and an independent fact about
    that link backs it up: Concerning, whatever the wording says."""
    brand = plan_.entities.brands[0][0]
    place = next(f["place"] for f in facts if f.get("place"))
    support = [f for f in facts if not f.get("place")]
    found = [_finding(f, _evidence_for(f.get("place") or place, material, teddy_item), "high" if f.get("place") else "medium") for f in facts]
    return _result(
        plan_, checks, found=found, outcome="concerning", attention="action_needed",
        overview=(f"This uses {brand}'s name, but its link goes to {place}, which isn't {brand}'s domain. {support[0]['text']} "
                  f"Don't use the link — go to {brand} directly through their official app or website."),
        means=(f"A genuine {brand} message has no reason to send you to another domain, and what's known about that address backs that up. "
               "That's enough to treat it as concerning without weighing up the wording."),
        how=f"Teddy DI checked the material using {_routes(checks)}. {_NOT_NEEDED}",
        reason=f"Anything typed into that link goes to whoever runs {place}, not {brand}.",
        actions=[_action("Don't use the link", f"Don't open {place} and don't enter anything on it."),
                 _action(f"Contact {brand} yourself", f"Contact {brand} using their official app, a website address you type yourself, or the number on your card or statement."),
                 _action("Report it", "Report it to Scamwatch at scamwatch.gov.au. If you've already entered details, contact the organisation now.")],
        uncertainties=["Apollo didn't open the page, so what it shows or asks for wasn't checked.",
                       *_missing(checks, "it couldn't change the outcome or what to do")])


def link_result(plan_: Plan, checks: list[Check], material: dict[str, str], teddy_item: str, outcome: str) -> dict:
    """A bare link Teddy DI couldn't clear, after every applicable resource. Magnum DI can't open the page
    either, so this is the result: Concerning, or Unable to determine."""
    hosts = ", ".join(plan_.entities.hosts[:3]) or "the link"
    facts = [(c, f) for c, f in _live(checks)]
    how = (f"Teddy DI used {_routes(checks)}. Magnum DI wasn't called: it can't open the page either, so it had nothing further that "
           "could change this result.")
    if outcome == "concerning":
        signals = [(c, f) for c, f in facts if f["signal"] in ("anomaly", "concern")]
        return _result(
            plan_, checks, outcome=outcome, attention="review", how=how,
            found=[_finding(f, _evidence(c, material, teddy_item), "medium") for c, f in facts],
            overview=(f"{hosts} raises a concern: {signals[0][1]['text']} Nothing here proves it's a scam, but don't enter anything on it "
                      "unless you reached it yourself from the organisation's official website or app."),
            means=("These checks look at who runs the address and whether any safety list or warning names it. One of them raises a concern, "
                   "and they can't show what the page asks you to do."),
            reason="A page like this can still collect whatever is typed into it.",
            actions=[_action("Don't enter details", "Don't enter passwords, codes or card details on this page."), _action("Go there directly", _CHECK_FIRST)],
            uncertainties=[*_missing(checks, None), "Apollo didn't open the page, so what it shows or asks for wasn't checked."])
    return _result(
        plan_, checks, outcome="unable_to_determine", attention="review", how=how,
        found=[_finding(f, _evidence(c, material, teddy_item), "medium") for c, f in facts],
        overview=(f"Apollo couldn't establish enough about {hosts} to say whether it's safe. Nothing it found raises a concern, but that "
                  "isn't the same as it being safe — only use it if you reached it yourself from the organisation's official website or app."),
        means="Some of the checks that would settle this couldn't be completed, so the available evidence can't establish more.",
        reason="An address Apollo couldn't fully check may still be unsafe.",
        actions=[_action("Check before using it", _CHECK_FIRST)],
        uncertainties=[*_missing(checks, None), "Apollo didn't open the page, so what it shows or asks for wasn't checked."])


def compose(basis: str, outcome: str, route: str, plan_: Plan, material: dict[str, str], teddy_item: str, unread: list[str],
            corroboration: list[dict]) -> dict:
    """Higgins' result for a case Teddy DI resolved, by what settled it."""
    if basis == "threat":
        return concern(plan_, plan_.checks, material, teddy_item, route, unread)
    if basis == "pattern":
        return pattern_result(plan_, plan_.checks, material, teddy_item, outcome)
    if basis == "impersonation":
        return impersonation_result(plan_, plan_.checks, material, teddy_item, corroboration)
    if outcome == "no_scam_indicators":
        return clear(plan_, plan_.checks, material, teddy_item, route)
    return link_result(plan_, plan_.checks, material, teddy_item, outcome)


def knowledge_answer(check: Check, route: str, presented: str, source_ids: list[str]) -> dict:
    """A general question answered from Apollo's KB or a targeted search — information, not a finding."""
    if route == "teddy_kb":
        overview = "Here's what Apollo's library says on this, from the sources below."
        body = presented
    else:
        lead = next((f for f in check.facts if f.get("class") == "live_evidence"), None)
        overview = (lead["text"] if lead else "Here's what a targeted search found.")[:600]
        sources = "\n".join(f"- {s['title']} — {s['url']}" for f in check.facts for s in (f.get("source") or {}).get("all") or [])
        body = f"{overview}\n\nSources:\n{sources}" if sources else overview
    return {
        "overview": overview[:900],
        "explanationMarkdown": f"{body}\n\n**How Apollo answered**\nTeddy DI answered this with {ROUTE_LABEL[route]}. It's general information, "
                               "not a finding about anything you've submitted.",
        "assessment": "no_concern_found_within_scope", "outcome": None, "attention": "none", "attentionReason": None, "findings": [],
        "uncertainties": ["This is general information. If something specific has happened to you, send it to Apollo to check."],
        "scope": "A general question — nothing was submitted to check.", "sourceIds": source_ids, "remainingEvidenceIds": [],
        "actions": [], "recommendedActionIndex": None, "question": None, "completion": "complete",
    }


def magnum_brief(checks: list[Check], unread_sections: dict, pattern: dict | None = None) -> str:
    """Only what Magnum DI needs: the open issues, the facts that bear on them, and what is still missing.
    Resolved, uneventful checks are named in one line so Magnum DI doesn't redo them; Apollo KB text isn't sent
    (a scam-pattern check is named in one line, as general knowledge)."""
    signals = [f"- {f['text']}" + (f" (source: {f['source']['publisher']})" if f.get("source") else "")
               for c in checks for f in c.facts if f.get("class") == "live_evidence" and f["signal"] in ("concern", "anomaly")]
    missing = [f"- {f['text']}" for c in checks for f in c.facts if f["signal"] == "missing"]
    missing += [f"- {c.subject}: lookup unavailable" for c in checks if c.status == "unavailable"]
    clean = sorted({f"{c.kind} {c.subject}" for c in checks for f in c.facts if f.get("class") == "live_evidence" and f["signal"] == "clear"})
    neutral = [f"- {f['text']}" for c in checks for f in c.facts if f.get("class") == "live_evidence" and f["signal"] == "neutral"]
    issues = [f"- {c.open_issue}" for c in checks if c.status == "needs_reasoning" and c.open_issue]
    parts = ["Teddy DI fly-by results for this case (live evidence, with sources)."]
    if signals:
        parts.append("Established signals:\n" + "\n".join(signals))
    if neutral:
        parts.append("Established facts:\n" + "\n".join(neutral[:8]))
    if clean:
        parts.append("Already checked with no concern: " + "; ".join(clean[:10]) + ".")
    if missing:
        parts.append("Looked up, not found or unavailable (missing evidence, not proof either way):\n" + "\n".join(missing))
    if pattern:
        how = {"full": "matches", "opening": "matches the opening of", "partial": "partly matches"}[pattern["stage"]]
        parts.append(f"Apollo KB pattern check (general knowledge, not evidence about this case): the material {how} the "
                     f"{pattern['name']} described by {pattern['publisher']}.")
    if issues:
        parts.append("Not settled by Teddy DI:\n" + "\n".join(issues))
    if unread_sections:
        parts.append("Other specialist results, verbatim: " + json.dumps(unread_sections, ensure_ascii=False, default=str))
    return "\n\n".join(parts)
