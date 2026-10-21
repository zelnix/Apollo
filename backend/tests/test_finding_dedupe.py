"""Findings that make the same point are merged before a result is returned."""
from services.higgins.contracts import ModelFinding
from services.higgins.validation import deduplicate_findings


def _finding(text: str, evidence: list[str] | None = None) -> ModelFinding:
    return ModelFinding(text=text, basis="observation" if evidence else "inference",
                        confidence="high", evidenceIds=evidence or [], sourceIds=[],
                        supersedesFindingIds=[])


def test_identical_restatements_collapse_to_one():
    kept = deduplicate_findings([
        _finding("The link goes to abc.net.au, which is not ING's domain.", ["EV-1"]),
        _finding("The link goes to www.abc.net.au, which is not ING's domain.", ["EV-1"]),
    ])
    assert len(kept) == 1


def test_the_more_informative_version_survives():
    short = _finding("The link goes to abc.net.au.")
    full = _finding("The link goes to abc.net.au, which is not ING's domain (ing.com.au).", ["EV-1"])
    kept = deduplicate_findings([short, full])
    assert [f.text for f in kept] == [full.text]


def test_distinct_facts_are_all_kept():
    kept = deduplicate_findings([
        _finding("The content presents itself as ING but the link goes to abc.net.au.", ["EV-1"]),
        _finding("It asks for your NetBank password.", ["EV-1"]),
        _finding("It refers to a payment of $920.00.", ["EV-1"]),
    ])
    assert len(kept) == 3


def test_a_single_finding_is_never_dropped():
    only = _finding("Nothing in the submitted material asks for money or credentials.", ["EV-1"])
    assert deduplicate_findings([only]) == [only]
    assert deduplicate_findings([]) == []
