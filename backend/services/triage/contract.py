"""Triage investigation contract — identical shape on device and server.

Three outcomes only. A Coverage Gap can prevent NO THREAT but can never create
POSSIBLE THREAT, and never downgrades threat evidence Apollo actually has.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

from services.triage.catalogue import VERSION, gap_plain, gap_recoverable, rule


class Outcome(str, Enum):
    NO_THREAT = "NO_THREAT_IDENTIFIED"
    POSSIBLE_THREAT = "POSSIBLE_THREAT_IDENTIFIED"
    LIMITED = "LIMITED_UNABLE_TO_DETERMINE"


class RuleResult(str, Enum):
    MET = "met"
    NOT_MET = "not_met"
    NOT_APPLICABLE = "not_applicable"
    COVERAGE_GAP = "coverage_gap"


#: Legacy triage verdicts (pre-2-tier model) mapped for history display only. The original
#: value is always preserved alongside; meaning is never rewritten in storage.
_LEGACY = {"SAFE": Outcome.NO_THREAT, "SUSPICIOUS": Outcome.POSSIBLE_THREAT, "UNCERTAIN": Outcome.LIMITED}


def legacy_outcome(verdict: str) -> Outcome:
    """Map a historical SAFE/SUSPICIOUS/UNCERTAIN verdict onto the current contract."""
    return _LEGACY.get((verdict or "").upper(), Outcome.LIMITED)


@dataclass
class RuleRecord:
    rule_id: str
    result: RuleResult
    evidence: list[str] = field(default_factory=list)
    gap_code: Optional[str] = None
    detail: str = ""

    @property
    def title(self) -> str:
        return rule(self.rule_id)["title"]

    def wire(self) -> dict:
        return {"ruleId": self.rule_id, "title": self.title, "category": rule(self.rule_id)["category"],
                "applicable": self.result is not RuleResult.NOT_APPLICABLE,
                "checked": self.result in (RuleResult.MET, RuleResult.NOT_MET),
                "result": self.result.value, "evidence": self.evidence,
                "coverageGap": self.gap_code, "detail": self.detail}


@dataclass
class CoverageGap:
    code: str
    detail: str
    rule_ids: list[str] = field(default_factory=list)
    #: How the lookup behind this gap failed, when known (timeout, quota_exhausted, auth_failure, …).
    failure: Optional[str] = None

    @property
    def recoverable(self) -> bool:
        return gap_recoverable(self.code)

    def wire(self) -> dict:
        return {"code": self.code, "detail": self.detail or gap_plain(self.code),
                "recoverable": self.recoverable, "ruleIds": self.rule_ids, "failure": self.failure}


@dataclass
class RetryRecord:
    check: str
    attempts: int
    outcome: str  # "recovered" | "failed" | "not_retried_permanent"

    def wire(self) -> dict:
        return {"check": self.check, "attempts": self.attempts, "outcome": self.outcome}


@dataclass
class TriageInvestigation:
    investigation_id: str
    source_type: str
    outcome: Outcome
    reason: str
    rules: list[RuleRecord] = field(default_factory=list)
    coverage_gaps: list[CoverageGap] = field(default_factory=list)
    #: Checks Apollo needed but couldn't finish ({check, status, failure, detail, source, at}) — see completeness.py.
    incomplete_checks: list[dict] = field(default_factory=list)
    retries: list[RetryRecord] = field(default_factory=list)
    correlation: dict = field(default_factory=dict)
    evaluated_at: Optional[datetime] = None
    #: Triage never spends tokens. Kept on the record as an auditable fact.
    gemini_calls: int = 0

    @property
    def should_escalate(self) -> bool:
        """Only a deterministic Possible Threat may start one Magnum DI investigation."""
        return self.outcome is Outcome.POSSIBLE_THREAT

    @property
    def met_rules(self) -> list[RuleRecord]:
        return [r for r in self.rules if r.result is RuleResult.MET]

    @property
    def recoverable(self) -> bool:
        """Whether re-checking could change the answer (drives any 'Check again' affordance)."""
        return any(gap.recoverable for gap in self.coverage_gaps)

    def wire(self) -> dict:
        return {
            "investigationId": self.investigation_id,
            "catalogueVersion": VERSION,
            "sourceType": self.source_type,
            "outcome": self.outcome.value,
            "reason": self.reason,
            "rulesApplicable": [r.rule_id for r in self.rules if r.result is not RuleResult.NOT_APPLICABLE],
            "rulesChecked": [r.rule_id for r in self.rules if r.result in (RuleResult.MET, RuleResult.NOT_MET)],
            "rulesMet": [r.rule_id for r in self.met_rules],
            "rules": [r.wire() for r in self.rules],
            "coverageGaps": [g.wire() for g in self.coverage_gaps],
            "incompleteChecks": self.incomplete_checks,
            # "incomplete" whenever any check Apollo needed didn't finish — never shown as a complete examination.
            "coverage": "incomplete" if (self.incomplete_checks or self.coverage_gaps) else "complete",
            "retries": [r.wire() for r in self.retries],
            "correlation": self.correlation,
            "recheckUseful": self.recoverable,
            "geminiCalls": self.gemini_calls,
            "evaluatedAt": self.evaluated_at.isoformat() if self.evaluated_at else None,
        }
