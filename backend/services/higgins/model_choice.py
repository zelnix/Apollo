"""Which Gemini model each feature calls. An admin changes it with one tap on the Gemini Map.

The choice is stored in the database, so it applies from the next call on every server process and survives
restarts and redeploys. With no choice stored, a feature uses the default model (provider.TEXT_MODEL).

TC FlyBy has no choice of its own: it always uses Magnum DI's model, so it is never on a stronger one.
"""
from __future__ import annotations

from core.db import db, now_utc
from services.gemini_usage import MODEL_PRICING
from services.higgins import provider

COLLECTION = "gemini_model_choices"
FOLLOWS = {"tc_flyby": "magnum_di"}
# What each feature's call asks of the model. Magnum DI reads images and documents, searches when it needs
# to and answers in a fixed shape; Ask Higgins answers in a fixed shape.
NEEDS = {"magnum_di": frozenset({"search", "vision", "json"}), "ask_higgins": frozenset({"json"})}


def eligible(feature: str) -> list[str]:
    """The models that can do this feature's job, cheapest first; a model with no price on file comes last."""
    fit = [model for model, caps in provider.CAPABILITIES.items() if NEEDS[feature] <= caps]
    return sorted(fit, key=lambda m: (m not in MODEL_PRICING, MODEL_PRICING.get(m, {}).get("input", 0), m))


async def choice(feature: str) -> dict | None:
    """The stored choice (model, who changed it and when), or None while the feature is on the default."""
    return await db[COLLECTION].find_one({"feature": FOLLOWS.get(feature, feature)}, {"_id": 0})


async def model_for(feature: str) -> str:
    feature = FOLLOWS.get(feature, feature)
    model = ((await choice(feature)) or {}).get("model")
    return model if model in eligible(feature) else provider.TEXT_MODEL


async def current() -> dict[str, str]:
    return {feature: await model_for(feature) for feature in ("magnum_di", "tc_flyby", "ask_higgins")}


async def choose(feature: str, model: str, email: str) -> str:
    """Store an admin's choice and return the model it replaces. A model that can't do the job is refused."""
    if feature not in NEEDS or model not in eligible(feature):
        raise ValueError(f"{model!r} can't be used for {feature!r}")
    before = await model_for(feature)
    await db[COLLECTION].update_one({"feature": feature}, {"$set": {"model": model, "changed_by": email, "changed_at": now_utc()}},
                                    upsert=True)
    return before
