"""Preview provider dispatch — the simulator handler for preview environments.

Called once from server.py lifespan, and only when APOLLO_PREVIEW_SIMULATOR=on. This module is
the ONLY place that imports preview_simulator. The production provider.py file
contains zero references to any preview module.

NOT A FALLBACK: this file is deployed with the project, but provider.register_preview_handler()
refuses to install it unless APOLLO_PREVIEW_SIMULATOR=on, so it cannot answer in production.
"""
from __future__ import annotations

import logging
import time
from typing import Any

_log = logging.getLogger("apollo.preview.dispatch")


async def _preview_generate(
    system: str,
    contents: Any,
    *,
    model: str,
    provider: str,
    capability: str,
    json_output: bool,
    web_search: bool,
    timeout: float,
    response_schema: Any | None,
    purpose: Any,
    correlation_id: str | None,
    trigger_source: str | None,
) -> Any:
    """Run the preview simulator — real workflow, simulated provider response."""
    from services.higgins.provider import _audit_payload, _owner_for
    from services.higgins import di_record as _di
    from services.higgins.preview.preview_simulator import simulate_generate

    audit = _audit_payload(system, contents, web_search)
    t0 = time.monotonic()
    result = await simulate_generate(
        system, contents, model=model, provider=provider, capability=capability,
        json_output=json_output, web_search=web_search, timeout=timeout,
        response_schema=response_schema, purpose=purpose,
        correlation_id=correlation_id, trigger_source=trigger_source,
        payload_audit=audit,
    )
    await _di.save_di_record(
        correlation_id=correlation_id,
        owner=_owner_for(correlation_id),
        investigation_id=(correlation_id or "").removeprefix("case-") or None,
        model=model,
        provider=provider,
        purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
        simulated=True, environment="Preview", status="success",
        request=_di.describe_request(system, contents, web_search),
        response_text=result.text, finish_reason=result.finish_reason,
        usage=result.usage, duration_ms=int((time.monotonic() - t0) * 1000),
        retries=0, calls=0,
    )
    return result


def install_preview_provider() -> None:
    """Register the preview handler on provider.py. Call once at startup."""
    from services.higgins.provider import register_preview_handler
    register_preview_handler(_preview_generate)
    _log.info("Preview provider dispatch installed")
