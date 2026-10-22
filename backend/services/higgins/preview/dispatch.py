"""Preview provider dispatch — the simulator handler for preview environments.

Called once from server.py lifespan if this module exists in the deployment. This module is
the ONLY place that imports preview_simulator. The production provider.py file
contains zero references to any preview module.

NOT A FALLBACK: in production this code is not deployed. It cannot run.
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
    capability: str,
    json_output: bool,
    tools: Any | None,
    timeout: float,
    response_schema: Any | None,
    purpose: Any,
    correlation_id: str | None,
    trigger_source: str | None,
) -> Any:
    """Run the preview simulator — real workflow, simulated Gemini response."""
    from services.higgins.provider import _audit_payload, _owner_for
    from services.higgins import di_record as _di
    from services.higgins.preview.preview_simulator import simulate_generate

    audit = _audit_payload(system, contents, tools)
    t0 = time.monotonic()
    result = await simulate_generate(
        system, contents, model=model, capability=capability,
        json_output=json_output, tools=tools, timeout=timeout,
        response_schema=response_schema, purpose=purpose,
        correlation_id=correlation_id, trigger_source=trigger_source,
        payload_audit=audit,
    )
    await _di.save_di_record(
        correlation_id=correlation_id,
        owner=_owner_for(correlation_id),
        investigation_id=(correlation_id or "").removeprefix("case-") or None,
        model=model,
        purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
        simulated=True, environment="Preview", status="success",
        request=_di.describe_request(system, contents, tools),
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
