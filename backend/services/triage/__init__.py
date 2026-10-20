"""Apollo deterministic Triage — Tier 1. Zero Gemini calls, ever.

One canonical rule catalogue (content/triage_catalogue.json) is shared with the
on-device engine (frontend/src/domain/triage). Evidence is evaluated wherever it
lives; the rule standard and the investigation record format are identical.
"""
from services.triage.catalogue import CATALOGUE, GAP_CODES, RULES, RULES_BY_CATEGORY, rule
from services.triage.contract import (CoverageGap, Outcome, RuleRecord, RuleResult, TriageInvestigation,
                                      legacy_outcome)
from services.triage.engine import evaluate, run_with_retries
from services.triage.store import record_triage_history

__all__ = ["CATALOGUE", "GAP_CODES", "RULES", "RULES_BY_CATEGORY", "rule", "CoverageGap", "Outcome",
           "RuleRecord", "RuleResult", "TriageInvestigation", "legacy_outcome", "evaluate",
           "run_with_retries", "record_triage_history"]
