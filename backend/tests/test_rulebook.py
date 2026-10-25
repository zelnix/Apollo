"""The rule book (content/rulebook.md) stays in step with the code, and each result's settling sentence comes from it.

If the first test fails: a file that defines one of Apollo's rules or processes changed. Update
backend/content/rulebook.md so it describes the code as it now is, then run `python scripts/rulebook_stamp.py`.
"""
import re

from routers import admin_portal
from routers.ask import ChatRequest
from services import rulebook, triage_engine
from services.higgins import chat, coordinator, evidence, jobs, outcomes, pipeline_submit, presenter
from services.higgins import context as chat_memory
from services.higgins.teddy import official, patterns, search
from services.higgins.teddy import triage as higgins_triage
from services.triage import CATALOGUE, RULES, Outcome

BOOK = rulebook.BOOK.read_text(encoding="utf-8")


def test_the_rule_book_was_reviewed_after_the_last_rule_change():
    behind = rulebook.changed()
    assert not behind, (f"These files define Apollo's rules or processes and changed since the rule book was last reviewed: {', '.join(behind)}. "
                        "Update backend/content/rulebook.md to match, then run `python scripts/rulebook_stamp.py`.")


def test_every_watched_file_exists():
    # A renamed or deleted rule file would otherwise drop out of the check without anyone noticing.
    missing = [path for path in rulebook.WATCHED if not (rulebook.ROOT / path).is_file()]
    assert not missing, f"Watched by the rule book but not found: {missing}. Update WATCHED in services/rulebook.py and re-stamp."


def _ask_higgins_section() -> str:
    return BOOK.split("{#ask-higgins}", 1)[1].split("\n## ", 1)[0]


def test_the_ask_higgins_rules_match_the_server():
    section = _ask_higgins_section()
    expected = [
        f"A message can be up to {ChatRequest.model_json_schema()['properties']['message']['maxLength']:,} characters",
        f"the question and answer for {int(chat_memory.CHAT_CONTENT_TTL.total_seconds() // 60)} minutes",
        f"a receipt with no content for {chat_memory.CHAT_RECEIPT_TTL.days} days",
        f"A general-knowledge answer is up to {chat.ModelChatReply.model_json_schema()['properties']['answer']['maxLength']:,} characters",
    ]
    missing = [phrase for phrase in expected if phrase not in section]
    assert not missing, f"The Ask Higgins rules no longer match the code on: {missing}"
    assert presenter.OUT_OF_SCOPE in BOOK, "the off-topic reply must be in the book word for word"


def test_a_typed_message_starts_a_check_only_as_the_book_says():
    assert "a phone number of 8 or more characters, or at least 30 characters of text" in _ask_higgins_section()
    # It has to ask plainly…
    assert pipeline_submit.detect_investigation_intent("Is this a scam? https://example.test")
    assert pipeline_submit.detect_investigation_intent("Should I click this?")
    assert not pipeline_submit.detect_investigation_intent("What scams are going around?")
    # …and hold something to check.
    assert pipeline_submit.extract_submittable_items("check 0412 345 678")[0]["kind"] == "phone"
    assert pipeline_submit.extract_submittable_items("check 1234567") == []          # 7 characters, and under 30 in all
    assert pipeline_submit.extract_submittable_items("check " + "x" * 24)[0]["kind"] == "text"   # exactly 30
    assert pipeline_submit.extract_submittable_items("check " + "x" * 23) == []


def test_every_number_in_the_rule_book_matches_the_code():
    ttl = triage_engine._CACHE_TTL
    expected = [
        f"catalogue of {len(RULES)} rules",
        f"up to {CATALOGUE['retryPolicy']['attempts']} attempts",
        f"a possible threat is kept {ttl[Outcome.POSSIBLE_THREAT].days} days and no threat {ttl[Outcome.NO_THREAT].days} days",
        f"links and domains (max {higgins_triage.MAX_LINKS})",
        f"account numbers; max {higgins_triage.MAX_PHONES})",
        f"email addresses (max {higgins_triage.MAX_EMAILS})",
        f"companies (max {higgins_triage.MAX_COMPANIES})",
        f"The {len(higgins_triage.REQUESTS)} types are",
        f"{official.LOOKUP_SECONDS:g} s per lookup",
        f"There are {len(patterns.PATTERNS)} patterns",
        f"at most {search.MAX_QUESTIONS} questions",
        f"answers are kept for {search.CACHE_DAYS} days",
        f"over {evidence.EVIDENCE_WORD_LIMIT:,} words",
        f"one retry after {jobs.RETRY_DELAY_SECONDS} seconds",
        f"limit of {coordinator.MAX_GEMINI_CALLS} calls per job",
        f"resubmit in about {jobs.RESUBMIT_AFTER_SECONDS // 60} minutes",
    ]
    missing = [phrase for phrase in expected if phrase not in BOOK]
    assert not missing, f"The rule book no longer matches the code on: {missing}"


def test_all_five_outcomes_are_in_the_rule_book():
    for label in outcomes.LABELS.values():
        assert f"**{label}**" in BOOK, label


def test_every_settling_rule_is_listed_in_the_rule_book_word_for_word():
    section = BOOK.split("{#settling-rules}", 1)[1].split("\n## ", 1)[0]
    for rule_id, (who, name) in rulebook.SETTLING_RULES.items():
        assert re.search(rf"^\| {re.escape(rule_id)} \| {re.escape(name)} \| {re.escape(who)} \|", section, re.M), rule_id


def _routing(answered_by, **teddy):
    return {"answeredBy": answered_by, "teddy": {"answeredBy": answered_by, **teddy}}


def test_tc_flyby_results_name_the_rule_that_settled_them():
    cases = [
        (_routing("teddy_official", basis="threat", outcome="confirmed_threat"), "FLYBY-THREAT", "direct safety check"),
        (_routing("teddy_search", basis="threat", outcome="confirmed_threat"), "FLYBY-THREAT", "official source found in TC FlyBy's search"),
        (_routing("teddy_kb", basis="pattern", outcome="likely_scam", pattern={"key": "family_new_number", "stage": "full"}), "FLYBY-PATTERN", "“Hi Mum”"),
        (_routing("teddy_kb", basis="pattern", outcome="concerning", pattern={"key": "family_new_number", "stage": "opening"}), "FLYBY-OPENING", "hasn't asked"),
        (_routing("teddy_official", basis="impersonation", outcome="concerning"), "FLYBY-IMPERSONATION", "isn't the organisation's website"),
        (_routing("teddy_search", basis="signals", outcome="concerning"), "FLYBY-SIGNS", "warning signs"),
        (_routing("teddy_official", basis="clear", outcome="no_scam_indicators"), "FLYBY-CLEAR", "every planned check"),
        (_routing("teddy_official", basis="unknown", outcome="unable_to_determine"), "FLYBY-UNKNOWN", "couldn't establish more"),
        (_routing("teddy_kb", basis="knowledge", outcome=None), "FLYBY-ANSWERED", "knowledge base"),
    ]
    for routing, rule_id, words in cases:
        reason = rulebook.settled_reason(routing)
        assert reason["ruleId"] == rule_id and reason["by"] == "TC FlyBy", routing
        assert reason["sentence"].startswith(f"Settled by TC FlyBy — {rulebook.SETTLING_RULES[rule_id][1]}: ") and words in reason["sentence"]
        assert reason["sentence"].endswith(".") and reason["sentence"].count(". ") == 0, "one sentence"


def test_magnum_di_results_name_why_they_went_to_magnum_di():
    reading = rulebook.settled_reason(_routing("magnum_di", basis=None, issues=[{"capability": "reading", "text": "Read page 1 directly."}]))
    assert reading["ruleId"] == "MAGNUM-READING" and reading["sentence"].startswith("Settled by Magnum DI — Reading: ")
    both = rulebook.settled_reason(_routing("magnum_di", basis=None, issues=[
        {"capability": "reading", "text": "Read the image."}, {"capability": "reasoning", "text": "Message and deception analysis."},
        {"capability": "reading", "text": "Read page 2."}]))
    assert both["rule"] == "Reading and reasoning" and both["sentence"].count("Settled by") == 1
    relating = rulebook.settled_reason(_routing("magnum_di", basis=None, issues=[{"capability": "relating", "text": "Conflict: …"}]))
    assert relating["ruleId"] == "MAGNUM-RELATING"
    question = rulebook.settled_reason(_routing("magnum_di", basis=None, issues=[{"capability": "reasoning", "text": "Answer the general question: x"}]))
    assert question["ruleId"] == "MAGNUM-QUESTION"
    # TC FlyBy reached a result, but it failed validation, so Magnum DI took the whole case.
    net = rulebook.settled_reason(_routing("magnum_di", basis="signals", outcome="concerning", issues=[]))
    assert net["ruleId"] == "MAGNUM-SAFETY-NET"


def test_no_reason_is_guessed_when_the_record_does_not_say():
    assert rulebook.settled_reason(None) is None
    assert rulebook.settled_reason({"answeredBy": "magnum_di"}) is None          # before routing was recorded
    assert rulebook.settled_reason(_routing("magnum_di", basis=None, issues=[])) is None


def test_the_sentence_never_repeats_anything_from_the_material():
    routing = _routing("teddy_official", basis="threat", outcome="confirmed_threat",
                       issues=[], checks=[{"kind": "link", "status": "resolved", "route": "official_source"}])
    routing["teddy"]["subject"] = "evil-commbank.example"
    assert "evil-commbank" not in rulebook.settled_reason(routing)["sentence"]


def test_the_admin_rule_book_page_is_the_shared_file(monkeypatch):
    monkeypatch.setattr(rulebook, "changed", lambda: [])
    page = admin_portal._rule_book_html()
    assert 'data-testid="rule-book-in-step"' in page and 'id="settling-rules"' in page
    assert "Settled by TC FlyBy — Known scam, every step" in page
    monkeypatch.setattr(rulebook, "changed", lambda: ["services/higgins/teddy/decide.py"])
    assert "rule-book-behind" in admin_portal._rule_book_html() and "decide.py" in admin_portal._rule_book_html()


def test_each_case_shows_its_reason_in_the_admin_portal():
    routing = _routing("teddy_kb", basis="pattern", outcome="likely_scam", pattern={"key": "family_new_number", "stage": "full"})
    row = admin_portal._settled_reason_html(routing)
    assert 'data-testid="settled-reason"' in row and "FLYBY-PATTERN" in row and "/api/admin/rule-book#settling-rules" in row
    assert "Not recorded" in admin_portal._settled_reason_html({})
