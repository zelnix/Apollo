"""Protection explanations: fixed, reviewed text only. No AI writes them.

  - An Apollo Protection (a Gate) has one canonical explanation, the same for everyone.
  - A Device Protection has a reviewed explanation when it is one of the common ones (protection_knowledge.DEVICE_SEEDS).
    Anything else has no explanation, and the app says so plainly rather than making one up.
The settings steps live with the device catalogue on the phone, and the person's current state is only ever the phone's
own read.
"""
from __future__ import annotations

from typing import Optional

from services.protection_knowledge import APOLLO_PROTECTIONS, DEVICE_SEEDS


def _wire(explanation: dict) -> dict:
    return {"what": explanation["what"], "why": explanation["why"], "protectsAgainst": explanation["protects_against"],
            "recommended": explanation.get("recommended")}


def apollo_explanation(protection_id: str) -> Optional[dict]:
    """The one canonical explanation of an Apollo Protection. Fixed text: the same for every user."""
    item = APOLLO_PROTECTIONS.get(protection_id)
    if not item:
        return None
    return {"protectionId": protection_id, "title": item["title"], "explanation": _wire(item), "version": item["version"],
            "source": "apollo_reviewed", "scopeLabel": "Every ApolloSG user"}


def reviewed_device_explanation(protection_id: str) -> Optional[dict]:
    """The reviewed explanation of a common Device Protection, or None."""
    seed = DEVICE_SEEDS.get(protection_id)
    if not seed:
        return None
    return {"protectionId": protection_id, "explanation": _wire(seed), "source": "apollo_reviewed", "scopeLabel": "Reviewed by Apollo"}
