"""Host canonicalization + event-safe URL sanitization (Python reference).

Parity contract (shared vectors: security/test-vectors/normalization/*.json):
  host:  trim -> strip one trailing dot -> IPv6 literal (validated, RFC 5952
         compressed, bracketed) | IPv4 literal | IDNA/UTS46 lowercase punycode.
         Labels 1..63 chars, [a-z0-9-], no leading/trailing '-', total <= 253.
  url:   scheme http/https only -> canonical host -> path only.
         sanitizedUrl = scheme://host + path   (no userinfo, port, query, fragment)
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import idna

_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
_IPV4_RE = re.compile(r"^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$")


def canonicalize_ipv6(literal: str) -> str | None:
    if "%" in literal:  # zone identifiers are never valid in a canonical host
        return None
    try:
        addr = ipaddress.IPv6Address(literal)
    except ValueError:
        return None
    return "[" + addr.compressed + "]"


def canonicalize_host(raw: str | None) -> str | None:
    if raw is None:
        return None
    host = raw.strip()
    if host.endswith("."):
        host = host[:-1]
    if not host:
        return None
    if host.startswith("[") and host.endswith("]"):
        return canonicalize_ipv6(host[1:-1])
    if ":" in host:
        return canonicalize_ipv6(host)
    if _IPV4_RE.match(host):
        return host
    try:
        ascii_host = idna.encode(host, uts46=True, transitional=False).decode("ascii")
    except idna.IDNAError:
        return None
    ascii_host = ascii_host.lower()
    if len(ascii_host) > 253:
        return None
    labels = ascii_host.split(".")
    if not all(_LABEL_RE.match(label) for label in labels):
        return None
    return ascii_host


@dataclass(frozen=True)
class SanitizedUrl:
    scheme: str
    host: str
    path: str
    original_had_query: bool
    original_had_fragment: bool
    original_had_userinfo: bool

    @property
    def sanitized_url(self) -> str:
        return f"{self.scheme}://{self.host}{self.path}"


def sanitize_url(raw: str) -> SanitizedUrl | None:
    """Parse the original candidate (analyzable locally) and derive the share-safe form."""
    try:
        parts = urlsplit(raw.strip())
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return None
    host = canonicalize_host(parts.hostname if not (parts.hostname or "").startswith("[") else parts.hostname)
    if host is None and parts.netloc:
        # urlsplit lowercases and strips brackets for IPv6; re-canonicalize from netloc
        netloc_host = parts.netloc.rsplit("@", 1)[-1]
        if netloc_host.startswith("["):
            host = canonicalize_host(netloc_host[: netloc_host.index("]") + 1])
    if host is None:
        return None
    path = parts.path or "/"
    if not path.startswith("/"):
        path = "/" + path
    return SanitizedUrl(
        scheme=scheme,
        host=host,
        path=path,
        original_had_query=bool(parts.query),
        original_had_fragment=bool(parts.fragment),
        original_had_userinfo="@" in parts.netloc,
    )
