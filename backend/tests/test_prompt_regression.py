"""Regression tests for the modular Higgins prompt architecture.

These tests validate INVARIANTS — not exact wording — to ensure the optimised
prompt produces correct Higgins behaviour across all categories.  Each test
case records input token count so token reduction is gated alongside behavioural
parity.

Run against the real Gemini model:
    APOLLO_PROVIDER_MODE=live python -m pytest tests/test_prompt_regression.py -v --tb=short

Run against simulated mode (structural checks only, no Gemini call):
    python -m pytest tests/test_prompt_regression.py -v --tb=short -k structural
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Optional

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.higgins.chat import SYSTEM, build_system_prompt, _PERMANENT_CORE, ModelChatReply
from services.higgins import app_knowledge
from services.higgins.context_tools import classify_context, ContextPlan


# ── Helpers ──────────────────────────────────────────────────────────────────

def _est_tokens(text: str) -> int:
    """Rough token estimate: average of char/4 and word*1.3."""
    return int((len(text) / 4 + len(text.split()) * 1.3) / 2)


@dataclass
class TokenReport:
    """Captures token counts for old vs new prompt on each test case."""
    question: str
    full_prompt_tokens: int = 0
    optimised_prompt_tokens: int = 0
    modules_used: list[str] = field(default_factory=list)
    routes_used: list[str] = field(default_factory=list)

    @property
    def savings_pct(self) -> float:
        if self.full_prompt_tokens == 0:
            return 0.0
        return (1 - self.optimised_prompt_tokens / self.full_prompt_tokens) * 100


_reports: list[TokenReport] = []


def _build_and_measure(question: str) -> tuple[str, TokenReport]:
    """Classify a question, build the optimised prompt, and measure tokens."""
    plan = classify_context(question)
    optimised = build_system_prompt(
        knowledge_modules=plan.knowledge_modules,
        route_groups=plan.route_groups,
    )
    report = TokenReport(
        question=question,
        full_prompt_tokens=_est_tokens(SYSTEM),
        optimised_prompt_tokens=_est_tokens(optimised),
        modules_used=plan.knowledge_modules,
        routes_used=plan.route_groups,
    )
    _reports.append(report)
    return optimised, report


# ── Structural invariant tests (run in any mode) ────────────────────────────

class TestPermanentCore:
    """The permanent core must always contain safety-critical invariants."""

    def test_role_separation_in_core(self):
        assert "APOLLO DETECTS" in _PERMANENT_CORE
        assert "TC FLYBY AND MAGNUM DI INVESTIGATE" in _PERMANENT_CORE
        assert "COMMUNICATES" in _PERMANENT_CORE and "HIGGINS" in _PERMANENT_CORE

    def test_scope_restriction_in_core(self):
        assert "SCOPE" in _PERMANENT_CORE
        assert "specialise" in _PERMANENT_CORE.lower() or "specialize" in _PERMANENT_CORE.lower()
        assert "general assistant" in _PERMANENT_CORE.lower()

    def test_device_snapshot_authority_in_core(self):
        assert "DEVICE SNAPSHOT" in _PERMANENT_CORE
        assert "authoritative" in _PERMANENT_CORE.lower()
        assert "never contradict" in _PERMANENT_CORE.lower()
        assert "never guess" in _PERMANENT_CORE.lower()

    def test_no_invented_state_in_core(self):
        assert "never invent" in _PERMANENT_CORE.lower()

    def test_uncertainty_handling_in_core(self):
        assert "uncertain" in _PERMANENT_CORE.lower()
        assert "precaution" in _PERMANENT_CORE.lower() or "safest" in _PERMANENT_CORE.lower()

    def test_investigation_boundary_in_core(self):
        assert "do not conduct" in _PERMANENT_CORE.lower() or "you do not investigate" in _PERMANENT_CORE.lower()
        assert "magnum di" in _PERMANENT_CORE.lower()

    def test_json_instruction_in_core(self):
        assert "json" in _PERMANENT_CORE.lower()

    def test_gate_status_rule_in_core(self):
        assert "offline" in _PERMANENT_CORE.lower()
        assert "ready" in _PERMANENT_CORE.lower() or "manual_checks_available" in _PERMANENT_CORE.lower()

    def test_follow_up_capability_in_core(self):
        lower = _PERMANENT_CORE.lower()
        assert "follow-up" in lower or "existing investigation" in lower or "stored findings" in lower


class TestKnowledgeBlock:
    """Knowledge block correctly assembles conditional modules."""

    def test_empty_modules_still_has_roles(self):
        kb = app_knowledge.knowledge_block(modules=[], route_groups=[])
        assert "WHO DOES WHAT" in kb
        assert "APOLLO" in kb
        assert "MAGNUM DI" in kb

    def test_empty_modules_still_has_protection_names(self):
        kb = app_knowledge.knowledge_block(modules=[], route_groups=[])
        assert "Websites & Links" in kb
        assert "Vision" in kb

    def test_empty_modules_has_no_routes(self):
        kb = app_knowledge.knowledge_block(modules=[], route_groups=[])
        assert "ROUTES:" not in kb

    def test_checks_routes_only(self):
        kb = app_knowledge.knowledge_block(modules=[], route_groups=["checks"])
        assert "CHECKS ROUTES:" in kb
        assert "/check" in kb
        assert "SETTINGS ROUTES:" not in kb

    def test_flows_module(self):
        kb = app_knowledge.knowledge_block(modules=["flows"], route_groups=[])
        assert "Triage then investigation" in kb or "triage" in kb.lower()

    def test_privacy_module(self):
        kb = app_knowledge.knowledge_block(modules=["privacy"], route_groups=[])
        assert "15 minutes" in kb or "credential" in kb.lower()

    def test_full_prompt_has_all_modules(self):
        all_modules = list(app_knowledge.KNOWLEDGE_MODULES.keys())
        all_routes = list(app_knowledge.ROUTE_GROUPS.keys())
        kb = app_knowledge.knowledge_block(modules=all_modules, route_groups=all_routes)
        assert "FLOWS" in kb.upper() or "triage" in kb.lower()
        assert "PRIVACY" in kb.upper() or "credential" in kb.lower()
        assert "CALL SCREENING" in kb
        assert "SETTINGS" in kb
        for group in all_routes:
            assert f"{group.upper()} ROUTES:" in kb


class TestClassifier:
    """Classifier returns correct modules and route groups, with fail-safe behaviour."""

    def test_general_scam_question_minimal(self):
        plan = classify_context("What is smishing?")
        # General scam question should need minimal context
        assert plan.label in ("general_knowledge", "learn_articles")

    def test_navigation_includes_tabs(self):
        plan = classify_context("Where do I find my saved reports?")
        assert "tabs" in plan.route_groups or "records" in plan.route_groups

    def test_check_question_includes_checks_routes(self):
        plan = classify_context("How do I check a link?")
        assert "checks" in plan.route_groups

    def test_privacy_question_includes_privacy_module(self):
        plan = classify_context("What does Apollo store about me?")
        assert "privacy" in plan.knowledge_modules

    def test_settings_question_includes_settings(self):
        plan = classify_context("How do I configure quiet hours?")
        assert "settings" in plan.route_groups or "settings_detail" in plan.knowledge_modules

    def test_growling_question_includes_flows(self):
        plan = classify_context("Why is Apollo growling?")
        assert "flows" in plan.knowledge_modules

    def test_call_screening_includes_module(self):
        plan = classify_context("How do I set Apollo as my call screener?")
        assert "call_screening" in plan.knowledge_modules

    def test_product_info_failsafe_includes_tabs(self):
        plan = classify_context("What can Apollo do?")
        assert "tabs" in plan.route_groups or "checks" in plan.route_groups

    def test_unknown_question_no_crash(self):
        plan = classify_context("asdfghjkl random gibberish 12345")
        assert isinstance(plan, ContextPlan)


class TestTokenReduction:
    """Verify token savings across representative question types."""

    CASES = [
        ("What is smishing?", 40, "general_knowledge"),
        ("Is this link safe?", 20, "checks_route"),
        ("Where are my saved reports?", 20, "navigation"),
        ("What does Apollo store about me?", 20, "privacy"),
        ("What scams are going around?", 30, "scam_alerts"),
        ("Is my phone protected?", 30, "protection_status"),
        ("How do I check a number?", 20, "check_navigation"),
        ("What's the capital of France?", 40, "refusal"),
    ]

    @pytest.mark.parametrize("question,min_savings_pct,label", CASES,
                             ids=[c[2] for c in CASES])
    def test_token_savings(self, question: str, min_savings_pct: int, label: str):
        _, report = _build_and_measure(question)
        assert report.savings_pct >= min_savings_pct, (
            f"Expected ≥{min_savings_pct}% savings for '{question}', "
            f"got {report.savings_pct:.1f}% "
            f"(full={report.full_prompt_tokens}, opt={report.optimised_prompt_tokens}, "
            f"modules={report.modules_used}, routes={report.routes_used})"
        )


class TestRouteValidation:
    """Route validation remains complete regardless of which groups are in the prompt."""

    def test_all_routes_still_valid(self):
        for route in app_knowledge.NAV_ROUTES:
            assert app_knowledge.valid_route(route), f"Route {route} should be valid"

    def test_invalid_route_rejected(self):
        assert not app_knowledge.valid_route("/nonexistent")
        assert not app_knowledge.valid_route("/admin/secret")


# ── Token report summary (printed at end of session) ────────────────────────

def pytest_sessionfinish(session, exitstatus):
    """Print a token usage summary after all tests complete."""
    if not _reports:
        return
    print("\n\n" + "=" * 70)
    print("TOKEN USAGE REPORT")
    print("=" * 70)
    print(f"{'Question':<50} {'Full':>6} {'Opt':>6} {'Save':>5}")
    print("-" * 70)
    for r in _reports:
        print(f"{r.question[:48]:<50} {r.full_prompt_tokens:>6} {r.optimised_prompt_tokens:>6} {r.savings_pct:>4.0f}%")
    avg = sum(r.savings_pct for r in _reports) / len(_reports) if _reports else 0
    print("-" * 70)
    print(f"{'Average savings':<50} {'':>6} {'':>6} {avg:>4.0f}%")
    print("=" * 70)
