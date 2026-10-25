"""The rule book (content/rulebook.md) stays in step with the code, and each result's settling sentence comes from it.

If the first test fails: a file that defines one of Apollo's rules or processes changed. Update
backend/content/rulebook.md so it describes the code as it now is, then run `python scripts/rulebook_stamp.py`.
"""
import re

from routers import admin_portal
from routers.ask import ChatRequest
from services import apollo_kb, kb_benchmark, kb_sources, rulebook, triage_engine
from services import reusable_intel as intel
from services.higgins import capacity, chat, coordinator, evidence, jobs, knowledge, llm_boundary, outcomes, pipeline_submit, presenter
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


def _section(anchor: str) -> str:
    return BOOK.split(f"{{#{anchor}}}", 1)[1].split("\n## ", 1)[0]


def test_the_privacy_rules_match_the_code():
    section = _section("privacy")
    expected = [
        f"other values over {llm_boundary._MAX_PARAM_VALUE_LEN} characters are cut",
        f"any link over {llm_boundary._MAX_URL_LEN} characters is cut",
    ]
    missing = [phrase for phrase in expected if phrase not in section]
    assert not missing, f"The privacy rules no longer match the code on: {missing}"
    # Secrets go, a word that only describes one stays, and scam evidence is kept.
    from core.redaction import redact_investigation_secrets
    assert "hunter2" not in redact_investigation_secrets("my password is hunter2") and "[redacted]" in section
    assert redact_investigation_secrets("click here for a password reset") == "click here for a password reset"
    assert "0412 345 678" in redact_investigation_secrets("Hi Mum, my new number is 0412 345 678")
    assert "[personal data withheld]" in section
    assert llm_boundary.enforce_boundary(llm_boundary.Purpose.ORDINARY_CHAT, {"home_address": "1 Smith St"}).get("home_address") in (None, "[personal data withheld]")


def test_the_knowledge_base_rules_match_the_code():
    section = _section("knowledge-base")
    tiers = apollo_kb.TIER_RESULTS
    expected = [
        f"Tier 1, official authority ({len(kb_sources.domains(kb_sources.TIER_1))} websites)",
        f"Tier 2, established security research ({len(kb_sources.domains(kb_sources.TIER_2))} websites)",
        f"Tier 3, supporting ({len(kb_sources.domains(kb_sources.TIER_3))} websites)",
        f"the last successful run is {apollo_kb.RUN_EVERY.days} days old and no attempt was made in the last {'day' if apollo_kb.RETRY_AFTER.days == 1 else f'{apollo_kb.RETRY_AFTER.days} days'}",
        f"searches {len(apollo_kb.GUIDANCE_TOPICS)} guidance topics",
        f"up to {tiers[kb_sources.TIER_1]} results from Tier 1, {tiers[kb_sources.TIER_2]} from Tier 2 and {tiers[kb_sources.TIER_3]} from Tier 3",
        f"and {len(apollo_kb.ALERT_TOPICS)} scam-alert topics",
        f"Up to {apollo_kb.MAX_RECHECKS} stored pages last checked {apollo_kb.RECHECK_AFTER.days} or more days ago",
        f"No more than {round(apollo_kb.MAX_LINK_DENSITY * 100)}% of its words are links",
        f"at least {apollo_kb.MIN_WORDS} words",
        f"at least {round(apollo_kb.SAME_PAGE * 100)}% the same, it is only marked as checked again",
        f"\"Updated\" shows for {apollo_kb.UPDATED_FOR.days} days",
        f"(at least {round(apollo_kb.NEAR_DUPLICATE * 100)}% the same)",
        f"fails to load on {apollo_kb.FAILED_CHECKS_BEFORE_HISTORICAL} re-reads",
        f"published more than {apollo_kb.ALERT_HISTORICAL_AFTER.days // 365} years ago",
        f"published within the last {apollo_kb.ALERT_MAX_AGE.days} days",
        f"holds at least {round(knowledge.MIN_COVERAGE * 100)}% of the question's weight",
        f"its score is at least {knowledge.MIN_SCORE:g}",
        f"a fixed benchmark of {len(kb_benchmark.cases())} questions and {len(kb_benchmark.cases(holdout=True))} held-out ones",
    ]
    missing = [phrase for phrase in expected if phrase not in section]
    assert not missing, f"The knowledge base rules no longer match the code on: {missing}"
    assert knowledge.GENERAL_KNOWLEDGE_NOTE in section, "the general-knowledge note, word for word"
    # What a saved AI answer's question may not hold.
    assert knowledge.storable("How do gift card scams work?")
    for personal in ("Is https://x.test a scam?", "Email me at a@b.co", "My account 1234567 was charged", "My name is Jo, am I safe?"):
        assert not knowledge.storable(personal), personal
    # Only trusted websites, over https.
    assert kb_sources.source_for("https://www.scamwatch.gov.au/x") and not kb_sources.source_for("http://www.scamwatch.gov.au/x")
    assert kb_sources.source_for("https://scamwatch.example.com/x") is None


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
        f"Something found counts as current for {intel.TTL['web_lookup'].days} days, \"nothing found\" for {intel.TTL['web_lookup_negative'].days} day",
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


# ── Your data, the Threats list and the check areas ─────────────────────────
def _days(delta) -> str:
    return f"{delta.days} days" if delta.days != 1 else "1 day"


def test_the_your_data_rules_match_the_code():
    from core.config import TOKEN_TTL_DAYS
    from services import account_deletion
    section = _section("your-data")
    expiry = chat_memory.EXPIRY
    expected = [
        f"expires {capacity.LIFETIME_SECONDS // 60} minutes after it opens",
        f"deleted from the server within {capacity.EVIDENCE_RETENTION_SECONDS // 3600} hours of the investigation finishing",
        f"The database removes it by itself at {capacity.EVIDENCE_RETENTION_SECONDS // 3600} hours",
        f"the question and answer for {int(chat_memory.CHAT_CONTENT_TTL.total_seconds() // 60)} minutes, then a receipt with no content for {chat_memory.CHAT_RECEIPT_TTL.days} days",
        f"a recent result for {_days(expiry['recent_outcome'])}, protection status for {int(expiry['protection_state'].total_seconds() // 3600)} hour, "
        f"a preference for {_days(expiry['preference'])}, a goal for {_days(expiry['goal'])} and a permission for {_days(expiry['permission'])}",
        f"At most {chat_memory.MAX_PER_CATEGORY} of each kind and {chat_memory.MAX_TOTAL} in all",
        f"a possible threat for {triage_engine._CACHE_TTL[Outcome.POSSIBLE_THREAT].days} days and no threat for {triage_engine._CACHE_TTL[Outcome.NO_THREAT].days} days",
        f"**TC FlyBy's search answers:** {intel.TTL['web_lookup'].days} days for something found and {intel.TTL['web_lookup_negative'].days} day for nothing found",
        f"deleted {intel.STALE_KEPT_FOR.days} days after they expire",
        f"Current for {intel.TTL['general_answer'].days} days, then deleted {intel.STALE_KEPT_FOR.days} days after that",
        f"valid for {TOKEN_TTL_DAYS} days",
        f"in {len(account_deletion.CATEGORIES)} groups: ",
    ]
    missing = [phrase for phrase in expected if phrase not in section]
    assert not missing, f"The Your data rules no longer match the code on: {missing}"
    for group in account_deletion.CATEGORIES.values():
        assert group["label"] in section, f"Delete My Apollo Data group missing from the book: {group['label']}"


def test_the_check_area_rules_match_the_code():
    import inspect
    from routers.analysis import AppAnalyseIn
    from services import feed_health, gmail, government_alerts, intel, mailbox_monitor
    count = lambda category: sum(1 for rule in RULES.values() if rule["category"] == category)  # noqa: E731
    expected = {
        "websites-links": [f"up to {inspect.signature(intel.expand_redirects_detailed).parameters['max_hops'].default} redirects",
                           f"There are {count('link')} link rules"],
        "call-text-guard": [f"{count('message')} message rules", f"Calls have {count('call')} rules"],
        "email-accounts": [f"the sign-in link expires after {int(gmail.OAUTH_STATE_TTL.total_seconds() // 60)} minutes",
                           f"every {mailbox_monitor.SCAN_SECONDS // 60} minutes, Apollo reads the next "
                           f"{inspect.signature(gmail.scan_inbox_page).parameters['limit'].default} messages",
                           f"There are {count('email')} email rules"],
        "apps-files": [f"There are {count('file')} file rules", f"There are {count('app')} app rules",
                       f"Up to {AppAnalyseIn.model_json_schema()['properties']['hosts']['maxItems']} web addresses"],
        "device-internet": [f"There are {count('device')} device rules", f"There are {count('network')} network rules"],
        "scam-alerts": [f"dated more than {government_alerts.RECENCY_CUTOFF.days} days ago",
                        f"more than {int(government_alerts.STALE_AFTER.total_seconds() // 3600)} hours old",
                        f"no successful read in {int(feed_health.STALE_AFTER.total_seconds() // 3600)} hours",
                        f"up to {inspect.signature(government_alerts.snapshot).parameters['limit'].default}"],
    }
    missing = [f"{anchor}: {phrase}" for anchor, phrases in expected.items() for phrase in phrases if phrase not in _section(anchor)]
    assert not missing, f"The check-area rules no longer match the code on: {missing}"
    assert gmail.SCOPE.endswith("/gmail.readonly") and "Read-only access only" in _section("email-accounts")


def test_every_rule_book_section_opens_on_its_own_in_the_admin_portal(monkeypatch):
    monkeypatch.setattr(rulebook, "changed", lambda: [])
    page = admin_portal._rule_book_html()
    sections = BOOK.count("\n## ")
    assert page.count('<details class="rb-section"') == sections
    assert "<details class=\"rb-section\" open" not in page, "every section starts closed"
    for anchor in ("your-data", "threats-list", "websites-links", "call-text-guard", "email-accounts", "apps-files",
                   "device-internet", "scam-alerts", "permissions", "settling-rules", "privacy"):
        assert f'<details class="rb-section" id="{anchor}"' in page, anchor
    assert 'data-rb-all="open"' in page and 'data-rb-all="close"' in page and "openFromHash" in page


def test_the_plain_english_rules_match_the_code():
    from services.higgins.explain import words
    section = BOOK.split("### Plain English and the Fidelity Check", 1)[1].split("\n## ", 1)[0]
    labels = {"none": "None", "review": "Review", "action_needed": "Action needed", "urgent": "Urgent"}
    missing = [level for level, line in words.SEVERITY.items() if f"| {labels[level]} | {line} |" not in section]
    assert not missing, f"The severity lines no longer match the code for: {missing}"
    for formal, plain in (("in order to", "to"), ("is unable to", "can't"), ("do not", "don't")):
        assert (formal, plain) in words.PLAIN_SWAPS and f'"{formal}" → "{plain}"' in section
    for term in ("domain", "phishing", "redirect", "registration record", "Safe Browsing", "IPQualityScore", "ABN", "PayID", "remote access"):
        assert any(t == term for t, _, _ in words.GLOSSARY) and term in section, term
    assert words.BASIS["observation"].format(by="TC FlyBy") in section and words.BASIS["user_report"] in section
    assert words.BASIS["inference"].format(by="Magnum DI") in section


def test_the_reusable_intelligence_rules_match_the_code():
    from pathlib import Path
    section = _section("knowledge-base").split("### Reusable intelligence (not KB knowledge)", 1)[1]
    days = lambda td: f"{td.days} day{'' if td.days == 1 else 's'}"  # noqa: E731
    hours = lambda td: f"{int(td.total_seconds() // 3600)} hours"  # noqa: E731
    rows = [("General question answered by AI", days(intel.TTL["general_answer"])),
            ("TC FlyBy search that found something", days(intel.TTL["web_lookup"])),
            ("TC FlyBy search that found nothing", days(intel.TTL["web_lookup_negative"])),
            ("Phone reputation (IPQualityScore)", hours(intel.TTL["phone_reputation"])),
            ("Link reputation (IPQualityScore)", hours(intel.TTL["url_reputation"])),
            ("Domain registration (RDAP)", hours(intel.TTL["domain_registration"]))]
    missing = [f"| {label} | {value} |" for label, value in rows if f"| {label} | {value} |" not in section]
    assert not missing, f"The freshness table no longer matches services/reusable_intel.py TTL: {missing}"
    assert len(rows) == len(intel.TTL)
    assert f"It is deleted {intel.STALE_KEPT_FOR.days} days after it expires" in section
    # The saved-answer matching rule (knowledge.answers_question): all words for 1-2, else at least 80%.
    assert "every content word, or at least 80% of them for longer questions" in section
    assert knowledge.answers_question("why do scammers ask for gift cards", ["scammer", "gift", "card"]) == 1.0
    assert knowledge.answers_question("why do scammers ask for crypto", ["scammer", "ask", "gift", "card"]) == 0.0
    # What the person is shown is the app's own sentence.
    app = (Path(rulebook.ROOT) / "frontend/src/domain/checkedAgo.ts").read_text()
    assert "From Apollo's check ${when}, still current, so it wasn't looked up again" in app
    assert "\"From Apollo's check 2 hours ago, still current, so it wasn't looked up again\"" in section
    assert knowledge.SAVED_ANSWER_NOTE.startswith("(ApolloSG saved this answer earlier. An AI tool wrote it")
    assert "Intelligence Reuse" in section and ("Intelligence Reuse", "/api/admin/intel-reuse", "&#9851;") in admin_portal.NAV
