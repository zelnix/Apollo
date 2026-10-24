"""Tavily client — used ONLY to populate and maintain the Apollo Knowledge Base (services/apollo_kb.py).

Never used by Magnum DI, by live investigations or to answer a person's question at the time it is asked.
Tavily is how Apollo finds and re-reads trusted pages; it is never the source of what Apollo knows. Its
generated answer is switched off, and every result is re-checked against the trusted-source list.
"""
from __future__ import annotations

import logging
import os
from urllib.parse import parse_qs, urlparse

import httpx

from core.db import db, now_utc
from services import kb_sources

log = logging.getLogger("apollo.tavily")

SEARCH_URL = "https://api.tavily.com/search"
EXTRACT_URL = "https://api.tavily.com/extract"


class TavilyUnavailable(Exception):
    """Not configured, or Tavily did not answer. The KB run records it and tries again next time."""


def _api_key() -> str:
    """The key on its own, or the key inside a Tavily MCP address (`...?tavilyApiKey=tvly-...`)."""
    value = (os.environ.get("TAVILY_API_KEY") or "").strip()
    if value.startswith("http"):
        value = (parse_qs(urlparse(value).query).get("tavilyApiKey") or [""])[0].strip()
    return value


def configured() -> bool:
    return bool(_api_key())


async def _post(url: str, payload: dict, operation: str) -> dict:
    key = _api_key()
    if not key:
        raise TavilyUnavailable("not_configured")
    ok = False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=8.0)) as client:
            response = await client.post(url, json=payload, headers={"Authorization": f"Bearer {key}"})
        if response.status_code != 200:
            raise TavilyUnavailable(f"http_{response.status_code}")
        ok = True
        return response.json()
    except httpx.HTTPError as exc:
        raise TavilyUnavailable(type(exc).__name__) from None
    finally:
        await db.trusted_search_usage.insert_one({"timestamp": now_utc(), "provider": "tavily", "purpose": "apollo_kb",
                                                  "operation": operation, "ok": ok})


def _trusted(url: str) -> bool:
    return kb_sources.source_for(url) is not None


async def search(query: str, *, domains: tuple[str, ...], topic: str = "general", time_range: str | None = None,
                 max_results: int = 5) -> list[dict]:
    """Pages on the given trusted domains, with their full text. [{url, title, rawContent, publishedDate}]"""
    payload = {"query": query[:400], "search_depth": "basic", "topic": topic, "max_results": max(1, min(max_results, 10)),
               "include_answer": False, "include_images": False, "include_raw_content": "markdown", "include_domains": list(domains)}
    if time_range:
        payload["time_range"] = time_range
    data = await _post(SEARCH_URL, payload, "search")
    return [{"url": str(item.get("url") or ""), "title": str(item.get("title") or "").strip()[:300],
             "rawContent": str(item.get("raw_content") or ""), "publishedDate": item.get("published_date")}
            for item in data.get("results") or [] if _trusted(str(item.get("url") or ""))]


async def extract(urls: list[str]) -> tuple[list[dict], list[str]]:
    """Re-read known pages. Returns ([{url, rawContent}], urls that could not be read)."""
    wanted = [url for url in urls if _trusted(url)][:20]
    if not wanted:
        return [], []
    data = await _post(EXTRACT_URL, {"urls": wanted, "format": "markdown", "extract_depth": "basic"}, "extract")
    read = [{"url": str(item.get("url") or ""), "rawContent": str(item.get("raw_content") or "")} for item in data.get("results") or []]
    failed = [str(item.get("url") or "") for item in data.get("failed_results") or []]
    return read, failed
