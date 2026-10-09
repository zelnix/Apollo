"""
Shared resilience utilities for external service calls.
Provides retry-with-backoff for any async httpx call.
"""
import asyncio
from typing import TypeVar

import httpx

from core.config import logger

T = TypeVar("T")

# Default retry configuration
DEFAULT_MAX_RETRIES = 2          # 1 original + 2 retries = 3 total attempts
DEFAULT_BACKOFF = 1.0            # seconds; doubled each retry
RETRYABLE_STATUS_CODES = {500, 502, 503, 504, 429}


async def resilient_get(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    timeout: httpx.Timeout | float = 10.0,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_BACKOFF,
    headers: dict | None = None,
    params: dict | None = None,
    label: str = "external",
) -> httpx.Response:
    """GET with automatic retry on transient failures (timeout, network, 5xx).

    Returns the successful response or raises the last exception after all retries.
    """
    last_exc: Exception | None = None
    for attempt in range(1 + max_retries):
        try:
            if client:
                resp = await client.get(url, headers=headers, params=params)
            else:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as http:
                    resp = await http.get(url, headers=headers, params=params)
            if resp.status_code in RETRYABLE_STATUS_CODES and attempt < max_retries:
                wait = backoff * (2 ** attempt)
                logger.warning("[%s] got %d, retry %d/%d in %.1fs", label, resp.status_code, attempt + 1, max_retries, wait)
                await asyncio.sleep(wait)
                continue
            return resp
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = backoff * (2 ** attempt)
                logger.warning("[%s] attempt %d/%d failed (%s), retry in %.1fs", label, attempt + 1, 1 + max_retries, type(exc).__name__, wait)
                await asyncio.sleep(wait)
            else:
                logger.error("[%s] all %d attempts failed: %s", label, 1 + max_retries, exc)
    raise last_exc  # type: ignore[misc]


async def resilient_post(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    timeout: httpx.Timeout | float = 10.0,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_BACKOFF,
    headers: dict | None = None,
    json: dict | list | None = None,
    content: bytes | None = None,
    label: str = "external",
) -> httpx.Response:
    """POST with automatic retry on transient failures."""
    last_exc: Exception | None = None
    for attempt in range(1 + max_retries):
        try:
            if client:
                resp = await client.post(url, headers=headers, json=json, content=content)
            else:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as http:
                    resp = await http.post(url, headers=headers, json=json, content=content)
            if resp.status_code in RETRYABLE_STATUS_CODES and attempt < max_retries:
                wait = backoff * (2 ** attempt)
                logger.warning("[%s] got %d, retry %d/%d in %.1fs", label, resp.status_code, attempt + 1, max_retries, wait)
                await asyncio.sleep(wait)
                continue
            return resp
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = backoff * (2 ** attempt)
                logger.warning("[%s] attempt %d/%d failed (%s), retry in %.1fs", label, attempt + 1, 1 + max_retries, type(exc).__name__, wait)
                await asyncio.sleep(wait)
            else:
                logger.error("[%s] all %d attempts failed: %s", label, 1 + max_retries, exc)
    raise last_exc  # type: ignore[misc]
