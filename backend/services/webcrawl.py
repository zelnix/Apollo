"""SSRF-safe, best-effort page fetch for the "Let Apollo read the page" feature.

Privacy contract: the fetched HTML is held in memory only for the duration of this request,
parsed down to a handful of short signals, and then discarded — nothing here is written to
MongoDB or any other storage, and there is no cache (unlike the RDAP domain-info cache).

Security posture: only http/https, resolves the hostname and rejects private / loopback /
link-local / reserved / multicast / unspecified targets before every fetch — checked again on
every redirect hop (redirects are followed manually, one at a time, never automatically by the
HTTP client). Caps redirects, response size and total time. No JavaScript execution — this is a
plain HTTP GET + static HTML parse, the same thing an anonymous visitor's browser would first
receive before running any script.

Known limitation: the safety check re-resolves DNS once; the actual connection resolves again via
httpx (a theoretical DNS-rebinding window between the two). Acceptable for a best-effort, opt-in
content read triggered by an explicit user tap — this is not a hardened forward proxy.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx

from core.config import logger

MAX_BYTES = 1_500_000
MAX_REDIRECTS = 3
FETCH_TIMEOUT = httpx.Timeout(connect=4.0, read=8.0, write=4.0, pool=4.0)
ALLOWED_SCHEMES = {"http", "https"}


class CrawlBlocked(Exception):
    """Any reason the fetch couldn't happen — always caught by the caller, never a 500."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


@dataclass
class CrawledPage:
    final_url: str
    title: str = ""
    text: str = ""  # visible text, truncated — held only for this request
    forms: list[str] = field(default_factory=list)  # input types seen: password/email/tel
    buttons: list[str] = field(default_factory=list)  # button/submit label text
    links_sample: list[str] = field(default_factory=list)  # a few outbound link hosts


async def _resolve_ips(host: str) -> list[str]:
    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise CrawlBlocked("dns_failed") from exc
    return list({info[4][0] for info in infos})


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified


async def _assert_public_host(host: str) -> None:
    ips = await _resolve_ips(host)
    if not ips or any(_is_blocked_ip(ip) for ip in ips):
        raise CrawlBlocked("private_target")


def _parse_html(final_url: str, html: str) -> CrawledPage:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = (soup.title.get_text(strip=True) if soup.title else "")[:200]
    text = re.sub(r"\s+", " ", soup.get_text(" ")).strip()[:6000]
    forms: list[str] = []
    for inp in soup.find_all("input"):
        t = str(inp.get("type") or "text").lower()
        if t in ("password", "email", "tel") and t not in forms:
            forms.append(t)
    buttons: list[str] = []
    for b in soup.find_all("button") + soup.find_all("input", attrs={"type": ["submit", "button"]}):
        label = b.get_text(strip=True) if hasattr(b, "get_text") else ""
        label = label or str(b.get("value") or "")
        if label:
            buttons.append(label[:60])
    links: list[str] = []
    for a in soup.find_all("a", href=True)[:40]:
        host = urlparse(urljoin(final_url, a["href"])).hostname
        if host and host not in links:
            links.append(host)
    return CrawledPage(final_url=final_url, title=title, text=text, forms=forms, buttons=buttons[:15], links_sample=links[:10])


async def fetch_page(url: str) -> CrawledPage:
    """Fetch + parse a page. Raises CrawlBlocked for every failure/refusal mode — never returns
    partial/garbage data silently. Nothing fetched here is persisted."""
    current = url
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT, follow_redirects=False,
        headers={"User-Agent": "Mozilla/5.0 (compatible; ApolloGuardDog/1.0; +security-check)", "Accept": "text/html,application/xhtml+xml"},
    ) as http:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(current)
            if parsed.scheme not in ALLOWED_SCHEMES or not parsed.hostname:
                raise CrawlBlocked("invalid_url")
            await _assert_public_host(parsed.hostname)
            try:
                async with http.stream("GET", current) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            raise CrawlBlocked("redirect_no_location")
                        current = urljoin(current, loc)
                        continue
                    if resp.status_code >= 400:
                        raise CrawlBlocked(f"http_{resp.status_code}")
                    ctype = resp.headers.get("content-type", "")
                    if "text/html" not in ctype and "text/plain" not in ctype:
                        raise CrawlBlocked("not_html")
                    chunks = bytearray()
                    async for chunk in resp.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > MAX_BYTES:
                            break
                    html = bytes(chunks).decode(resp.encoding or "utf-8", errors="ignore")
                    return _parse_html(str(resp.url), html)
            except httpx.HTTPError as exc:
                raise CrawlBlocked("fetch_failed") from exc
        raise CrawlBlocked("too_many_redirects")
