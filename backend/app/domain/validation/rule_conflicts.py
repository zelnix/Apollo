"""Pre-signing rule validation.

Rejects: duplicate rule IDs, non-canonical/invalid hosts, and contradictory
actions for the same normalized host (covers case, trailing-dot, Unicode and
punycode equivalence because every host is canonicalized first).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.models.rule_entry import RuleEntry
from app.domain.validation.normalization import canonicalize_host


@dataclass
class RuleValidationError(Exception):
    problems: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return "; ".join(self.problems)


def validate_and_canonicalize(rules: list[RuleEntry]) -> list[RuleEntry]:
    problems: list[str] = []
    seen_ids: set[str] = set()
    action_by_host: dict[str, tuple[str, str]] = {}
    out: list[RuleEntry] = []

    for rule in rules:
        if rule.ruleId in seen_ids:
            problems.append(f"duplicate ruleId '{rule.ruleId}'")
        seen_ids.add(rule.ruleId)

        canonical = canonicalize_host(rule.host)
        if canonical is None:
            problems.append(f"rule '{rule.ruleId}': invalid host")
            continue
        prior = action_by_host.get(canonical)
        if prior is not None:
            prior_action, prior_id = prior
            if prior_action != rule.action:
                problems.append(
                    f"conflicting actions for host '{canonical}': '{prior_id}'={prior_action} vs '{rule.ruleId}'={rule.action}"
                )
            else:
                problems.append(f"duplicate host '{canonical}' in rules '{prior_id}' and '{rule.ruleId}'")
        else:
            action_by_host[canonical] = (rule.action, rule.ruleId)
        out.append(rule.model_copy(update={"host": canonical}))

    if problems:
        raise RuleValidationError(problems)
    return out
