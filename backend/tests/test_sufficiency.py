"""Knowledge sufficiency (services/sufficiency.py): KNOWN / PARTIAL / UNKNOWN. Deterministic, no AI, no I/O.

KNOWN only when the KB answers, or a reusable result is fresh, about this exact subject, complete, usable and not
contradicted — and never for a check that must be current. Anything else leaves the existing path as it was.

Run: cd /app/backend && python -m pytest tests/test_sufficiency.py -q
"""
import copy
from datetime import timedelta

from core.db import now_utc
from services import reusable_intel as intel
from services.sufficiency import KNOWN, PARTIAL, UNKNOWN, Requirement, assess

NOW = now_utc()
KEY = "link|domain:example-scam.top"
KB_ENTRY = {"kb_id": "learn_article:payid-scams", "kind": "learn_article", "status": "current", "title": "PayID scams", "body": "..."}


def record(key: str = KEY, *, expires_in: timedelta = timedelta(days=3), status: str = "WARNING", **payload) -> dict:
    return {"cache_id": f"{key}:{expires_in}:{status}", "subject_key": key, "last_verified_at": NOW - timedelta(hours=2),
            "expires_at": NOW + expires_in, "payload": {"status": status, "fact": "ASIC lists it.", **payload}}


# ── KNOWN ────────────────────────────────────────────────────────────────────
def test_kb_knowledge_is_known():
    d = assess(Requirement(KEY), kb=[KB_ENTRY], now=NOW)
    assert (d.level, d.reason, d.kb, d.reuse) == (KNOWN, "kb_match", [KB_ENTRY], [])
    assert d.known


def test_kb_answers_before_any_reusable_result():
    d = assess(Requirement(KEY), kb=[KB_ENTRY], cache=[record()], now=NOW)
    assert d.level == KNOWN and d.kb == [KB_ENTRY] and d.reuse == [], "the authoritative KB is used first; the cache is not touched"


def test_a_historical_kb_entry_is_still_known_and_labelled_by_the_kb():
    old = {**KB_ENTRY, "status": "historical"}
    d = assess(Requirement(KEY), kb=[old], now=NOW)
    assert (d.level, d.reason, d.kb) == (KNOWN, "kb_historical", [old])


def test_a_fresh_complete_result_about_this_subject_is_known():
    fresh = record()
    d = assess(Requirement(KEY, needs=("status", "fact")), cache=[fresh], now=NOW)
    assert (d.level, d.reason, d.reuse, d.stale) == (KNOWN, "fresh_cache", [fresh], [])


def test_fresh_and_expired_records_known_with_the_expired_one_as_history_only():
    fresh, old = record(), record(expires_in=-timedelta(days=1))
    d = assess(Requirement(KEY), cache=[fresh, old], now=NOW)
    assert d.level == KNOWN and d.reuse == [fresh] and d.stale == [old]


# ── PARTIAL ──────────────────────────────────────────────────────────────────
def test_an_expired_result_is_partial_and_never_current():
    old = record(expires_in=-timedelta(minutes=1))
    d = assess(Requirement(KEY), cache=[old], now=NOW)
    assert (d.level, d.reason, d.reuse, d.stale) == (PARTIAL, "expired", [], [old])


def test_a_result_expiring_exactly_now_is_expired():
    d = assess(Requirement(KEY), cache=[record(expires_in=timedelta(0))], now=NOW)
    assert d.level == PARTIAL and d.reason == "expired"


def test_an_incomplete_result_is_partial():
    for empty in (None, "", [], {}):
        d = assess(Requirement(KEY, needs=("status", "registrar")), cache=[record(registrar=empty)], now=NOW)
        assert (d.level, d.reason, d.reuse) == (PARTIAL, "missing:registrar", []), empty


def test_a_result_that_does_not_answer_the_need_is_partial():
    d = assess(Requirement(KEY, usable=lambda p: p["status"] != "UNSOURCED"), cache=[record(status="UNSOURCED")], now=NOW)
    assert (d.level, d.reason, d.reuse) == (PARTIAL, "not_usable", [])


def test_contradicting_fresh_results_are_partial():
    a, b = record(status="WARNING"), record(status="NO_WARNING_FOUND")
    d = assess(Requirement(KEY), cache=[a, b], now=NOW)
    assert (d.level, d.reason, d.reuse) == (PARTIAL, "conflict", [])


def test_a_check_that_must_be_current_is_never_settled_from_memory():
    d = assess(Requirement(KEY, live=True), kb=[KB_ENTRY], cache=[record()], now=NOW)
    assert (d.level, d.reason, d.reuse, d.kb) == (PARTIAL, "live_required", [], [])
    assert d.stale, "what Apollo held is context only"
    assert assess(Requirement(KEY, live=True), now=NOW).level == UNKNOWN


# ── UNKNOWN ──────────────────────────────────────────────────────────────────
def test_nothing_relevant_is_unknown():
    d = assess(Requirement(KEY), now=NOW)
    assert (d.level, d.reason, d.kb, d.reuse, d.stale) == (UNKNOWN, "no_match", [], [], [])


def test_a_result_about_another_subject_is_never_reused():
    d = assess(Requirement(KEY), cache=[record("link|domain:another-site.top")], now=NOW)
    assert (d.level, d.reuse) == (UNKNOWN, [])


# ── Determinism, counters, no content ────────────────────────────────────────
def test_assessment_is_deterministic_and_never_changes_its_inputs():
    cache = [record(), record(expires_in=-timedelta(days=2))]
    before = copy.deepcopy(cache)
    first = assess(Requirement(KEY, needs=("fact",)), cache=cache, now=NOW)
    second = assess(Requirement(KEY, needs=("fact",)), cache=cache, now=NOW)
    assert (first.level, first.reason, first.reuse, first.stale) == (second.level, second.reason, second.reuse, second.stale)
    assert cache == before


def test_reasons_are_content_free():
    secret = "Jane Citizen 0412 345 678"
    for d in (assess(Requirement(KEY), cache=[record(fact=secret)], now=NOW),
              assess(Requirement(KEY, needs=("owner",)), cache=[record(fact=secret)], now=NOW),
              assess(Requirement(KEY), cache=[record(fact=secret, expires_in=-timedelta(days=1))], now=NOW)):
        assert secret not in d.reason and "Jane" not in " ".join(d.events(call_made=False))


def test_each_decision_adds_the_right_aggregate_counters():
    assert assess(Requirement(KEY), cache=[record()], now=NOW).events(call_made=False) == ["sufficiency_known", "cache_hit", "external_call_avoided"]
    assert assess(Requirement(KEY), kb=[KB_ENTRY], now=NOW).events(call_made=False) == ["sufficiency_known", "kb_hit", "external_call_avoided"]
    assert assess(Requirement(KEY), cache=[record(expires_in=-timedelta(days=1))], now=NOW).events(call_made=True) == [
        "sufficiency_partial", "cache_expired", "external_call_required"]
    assert assess(Requirement(KEY), now=NOW).events(call_made=True) == ["sufficiency_unknown", "external_call_required"]


def test_every_counter_a_decision_can_add_is_a_declared_event():
    decisions = [assess(Requirement(KEY), kb=[KB_ENTRY], now=NOW), assess(Requirement(KEY), cache=[record()], now=NOW),
                 assess(Requirement(KEY, live=True), cache=[record()], now=NOW), assess(Requirement(KEY), now=NOW),
                 assess(Requirement(KEY), cache=[record(expires_in=-timedelta(days=1))], now=NOW)]
    for d in decisions:
        for call_made in (True, False):
            assert set(d.events(call_made=call_made)) <= set(intel.EVENTS)
