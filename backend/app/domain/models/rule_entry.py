from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RuleAction = Literal["block", "allow"]


class RuleEntry(BaseModel):
    """One exact-host rule. `host` must already be canonical (see normalization)."""

    model_config = ConfigDict(extra="forbid")

    ruleId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    host: str = Field(min_length=1, max_length=253)
    action: RuleAction
    matchType: Literal["exact"] = "exact"
    category: str = Field(default="uncategorized", min_length=1, max_length=64)
