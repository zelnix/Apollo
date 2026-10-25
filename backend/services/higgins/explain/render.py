"""Higgins Plain-English Renderer: a validated result, in everyday words, in Apollo's wording only.

A presentation layer under the Evidence Lock. It can't add, drop or change a fact, a value, how sure Apollo is, how
serious it is, what to do or who established it. All it does is this:
  - removes Markdown, and swaps formal words for plain ones (words.PLAIN_SWAPS), never inside quotes or identifiers;
  - says each point once (a sentence already said isn't repeated);
  - labels each finding with who established it and how firmly;
  - adds Apollo's fixed explanation of the first jargon word in a finding (words.GLOSSARY), marked as explanatory;
  - opens with the outcome's label and says how serious it is in one fixed line (words.SEVERITY).
No AI is used. The Fidelity Check (fidelity.py) compares the draft against the facts before anything is shown; any
part that fails is shown in Apollo's own words instead (`literal`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterator, Optional

from services.higgins import outcomes
from services.higgins.explain import words as W
from services.higgins.explain.facts import ENTITY_PATTERNS, Facts, sentences

QUOTE = re.compile(r"“[^”\n]{1,500}”|\"[^\"\n]{1,500}\"")
_HOLD = re.compile(r"\x00(\d+)\x00")


def plain(text: str) -> str:
    """Plain words for `text`. Quotes and identifiers (links, addresses, numbers, dates, amounts) stay word for word."""
    held: list[str] = []

    def hold(m: re.Match) -> str:
        held.append(m.group(0))
        return f"\x00{len(held) - 1}\x00"

    out = QUOTE.sub(hold, text)
    for pattern in ENTITY_PATTERNS.values():
        out = pattern.sub(hold, out)
    out = W.swap(out)
    for _ in range(4):  # a held span can itself hold an earlier one
        if not _HOLD.search(out):
            break
        out = _HOLD.sub(lambda m: held[int(m.group(1))], out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


@dataclass
class Item:
    ref: str          # which authoritative part it renders: "result", "finding:0", "means:1", "todo:0", ...
    text: str
    detail: str = ""
    explain: str = ""
    finding_id: Optional[str] = None


@dataclass
class Draft:
    result: Item
    severity: str
    established: list[Item] = field(default_factory=list)
    means: list[Item] = field(default_factory=list)
    matters: list[Item] = field(default_factory=list)
    todo: list[Item] = field(default_factory=list)
    uncertain: list[Item] = field(default_factory=list)
    how: list[Item] = field(default_factory=list)

    def items(self) -> Iterator[Item]:
        yield self.result
        for group in (self.established, self.means, self.matters, self.todo, self.uncertain, self.how):
            yield from group


def label(f: Facts) -> str:
    return f"{outcomes.LABELS[f.outcome]}." if f.outcome else ""


def literal_parts(f: Facts) -> dict[str, str]:
    """Apollo's own wording for every part, by ref. What a failed part is shown as instead."""
    parts = {"result": " ".join(p for p in [label(f), *f.verdict] if p)}
    parts.update({f"finding:{i}": x["text"] for i, x in enumerate(f.findings)})
    parts.update({f"means:{i}": f"{t}: {p}" if t else p for i, (t, p) in enumerate(f.meaning)})
    if f.attention_reason:
        parts["matters:0"] = f.attention_reason
    parts.update({f"todo:{i}": a["instruction"] for i, a in enumerate(f.actions)})
    parts.update({f"uncertain:{i}": u for i, u in enumerate(f.uncertainties)})
    parts.update({f"how:{i}": h for i, h in enumerate(f.how)})
    return parts


def render(f: Facts, literal: frozenset[str] = frozenset()) -> Draft:
    """The plain-English draft. Parts named in `literal` keep Apollo's own wording."""
    from services.higgins.explain.fidelity import faithful  # the same test of "the same point" the check uses

    parts = literal_parts(f)
    said: list[str] = []

    def word(ref: str) -> str:
        return parts[ref] if ref in literal or "*" in literal else plain(parts[ref])

    def once(ref: str) -> str:
        """Its sentences that haven't been said yet. A part in Apollo's own wording is kept whole."""
        text = word(ref)
        if ref in literal or "*" in literal:
            said.extend(sentences(text))
            return text
        kept = [s for s in sentences(text) if not any(faithful(s, prior) and faithful(prior, s) for prior in said)]
        said.extend(kept)
        return " ".join(kept)

    # Every finding is listed, whatever else says it: findings are registered first, so nothing else repeats them.
    explained: set[str] = set()
    established = []
    for i, finding in enumerate(f.findings):
        text = word(f"finding:{i}")
        said.extend(sentences(text))
        established.append(Item(ref=f"finding:{i}", text=text, detail=W.detail(finding["basis"], finding["confidence"], f.by),
                                explain=W.jargon(finding["text"], explained), finding_id=finding["id"]))

    # The answer: the outcome by its label, then what the result says that the findings don't already.
    if "result" in literal or "*" in literal:
        result = parts["result"]
    else:
        verdict = [s for s in sentences(" ".join(plain(v) for v in f.verdict))
                   if not any(faithful(s, prior) and faithful(prior, s) for prior in said)]
        said.extend(verdict)
        result = " ".join(p for p in [label(f), *verdict] if p)

    def section(prefix: str, count: int) -> list[Item]:
        items = [Item(ref=f"{prefix}:{i}", text=once(f"{prefix}:{i}")) for i in range(count)]
        return [item for item in items if item.text]

    draft = Draft(result=Item(ref="result", text=result), severity=W.SEVERITY[f.attention], established=established)
    draft.means = section("means", len(f.meaning))
    draft.matters = section("matters", 1 if f.attention_reason else 0)
    # Every step is kept, one for one with the actions the screen shows.
    draft.todo = [Item(ref=f"todo:{i}", text=word(f"todo:{i}")) for i in range(len(f.actions))]
    draft.uncertain = section("uncertain", len(f.uncertainties))
    draft.how = section("how", len(f.how))
    return draft
