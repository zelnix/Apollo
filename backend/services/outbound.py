"""Bounded public-web transport. DNS is resolved once per hop; the socket uses that IP.

No environment proxies, cookies, credentials, automatic redirects or decompression.
TLS still verifies the ORIGINAL hostname (SNI), not the pinned numeric address.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from contextlib import asynccontextmanager
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 1_500_000
_slots = asyncio.Semaphore(8)
REDIRECTS = {301, 302, 303, 307, 308}


class OutboundBlocked(ValueError):
    pass


def public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
        if not ip.is_global or ip.is_multicast or ip.is_reserved or '%' in value:
            return False
        if isinstance(ip, ipaddress.IPv6Address):
            # Reject transition/translation forms, even if Python labels them global.
            if ip.ipv4_mapped or ip.sixtofour or ip.teredo:
                return False
            if ip in ipaddress.ip_network('64:ff9b::/96') or ip in ipaddress.ip_network('64:ff9b:1::/48'):
                return False
        return True
    except ValueError:
        return False


def parse_target(url: str) -> httpx.URL:
    try:
        if len(url) > 2048 or any(ord(c) <= 32 for c in url) or '\\' in url:
            raise ValueError()
        p = urlsplit(url)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
            raise ValueError()
        if p.port not in (None, 80 if p.scheme == 'http' else 443):
            raise ValueError()
        u = httpx.URL(url)
        if '%' in u.host or u.host.lower().rstrip('.') in ('localhost', 'localhost.localdomain'):
            raise ValueError()
        return u.copy_with(fragment=None)
    except (ValueError, httpx.InvalidURL) as exc:
        raise OutboundBlocked('invalid_target') from exc


async def resolve_public(host: str, port: int) -> list[str]:
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        try:
            infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
                host, port, type=socket.SOCK_STREAM), timeout=3)
            ips = sorted({row[4][0] for row in infos})
        except (OSError, asyncio.TimeoutError) as exc:
            raise OutboundBlocked('dns_failed') from exc
    else:
        ips = [str(literal)]
    if not ips or any(not public_ip(ip) for ip in ips):
        raise OutboundBlocked('private_target')
    return ips


@asynccontextmanager
async def public_stream(method: str, url: str):
    """One pinned hop. Caller must consume inside this context; total deadline includes queue/DNS."""
    async with asyncio.timeout(12), _slots:
        target = parse_target(url)
        ips = await resolve_public(target.host, target.port or (443 if target.scheme == 'https' else 80))
        pinned = target.copy_with(host=ips[0])
        async with httpx.AsyncClient(timeout=4, follow_redirects=False, trust_env=False) as http:
            async with http.stream(method, pinned, headers={
                'Host': target.netloc.decode('ascii'), 'Accept-Encoding': 'identity',
                'User-Agent': 'Apollo-Security-Check/1.0',
            }, extensions={'sni_hostname': target.host}) as response:
                yield response


async def bounded_body(response: httpx.Response, limit: int = MAX_BYTES) -> bytes:
    if response.headers.get('content-encoding', 'identity').lower() not in ('', 'identity'):
        raise OutboundBlocked('encoded_body_not_supported')
    length = response.headers.get('content-length')
    if length and (not length.isdigit() or int(length) > limit):
        raise OutboundBlocked('body_too_large')
    data = bytearray()
    async for chunk in response.aiter_raw(chunk_size=16384):
        if len(data) + len(chunk) > limit:
            raise OutboundBlocked('body_too_large')
        data.extend(chunk)
    return bytes(data)


async def public_get(url: str, max_hops: int = 3) -> httpx.Response:
    async with asyncio.timeout(15):
        for hop in range(max_hops + 1):
            # Preflight every hop with headers only. A server may not implement HEAD (or may reject
            # it), in which case the bounded GET below is the explicit fallback. Redirect targets
            # are re-parsed and re-resolved before any request reaches them.
            async with public_stream('HEAD', url) as preflight:
                if preflight.status_code in REDIRECTS:
                    if hop == max_hops or not preflight.headers.get('location'):
                        raise OutboundBlocked('too_many_redirects')
                    url = urljoin(url, preflight.headers['location'])
                    continue
                if preflight.status_code not in (400, 403, 405):
                    # Validate advertised size/encoding without consuming a response body.
                    await bounded_body(preflight)
            async with public_stream('GET', url) as response:
                if response.status_code in REDIRECTS:
                    if hop == max_hops or not response.headers.get('location'):
                        raise OutboundBlocked('too_many_redirects')
                    url = urljoin(url, response.headers['location'])
                    continue
                content = await bounded_body(response)
                return httpx.Response(response.status_code, headers=response.headers, content=content,
                                      request=httpx.Request('GET', url))
    raise OutboundBlocked('fetch_failed')