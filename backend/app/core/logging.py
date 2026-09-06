"""Logging with raw-URL redaction.

Privacy rule (M1): raw browsing URLs must never appear in application logs,
error traces, or debug telemetry. Every record passing through the Guard Dog
loggers is scrubbed: anything that looks like a URL is replaced by a marker.
Intelligence lookups additionally never log the sanitized URL either - only
the verdict source and hashed lookup key.
"""
from __future__ import annotations

import logging
import re

_URL_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s\"'<>]+")
REDACTED = "[url-redacted]"


class RawUrlRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _URL_RE.sub(REDACTED, record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: _scrub(v) for k, v in record.args.items()}
            else:
                record.args = tuple(_scrub(a) for a in record.args)
        return True


def _scrub(value):
    return _URL_RE.sub(REDACTED, value) if isinstance(value, str) else value


class SecretRedactionFilter(logging.Filter):
    """Redacts configured secret values (private key seeds, admin token, provider key) from every record."""

    def __init__(self, secrets: list[str]):
        super().__init__()
        self._secrets = [s for s in secrets if len(s) >= 8]

    def _scrub(self, value):
        if not isinstance(value, str):
            return value
        for s in self._secrets:
            value = value.replace(s, "[secret-redacted]")
        return value

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._scrub(record.msg)
        if record.args:
            record.args = {k: self._scrub(v) for k, v in record.args.items()} if isinstance(record.args, dict) else tuple(self._scrub(a) for a in record.args)
        return True


def configure_logging(secrets: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    filters: list[logging.Filter] = [RawUrlRedactionFilter()]
    if secrets:
        filters.append(SecretRedactionFilter(secrets))
    for name in ("", "guarddog", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        for f in filters:
            if not any(type(existing) is type(f) for existing in logger.filters):
                logger.addFilter(f)
            for handler in logger.handlers:
                if not any(type(existing) is type(f) for existing in handler.filters):
                    handler.addFilter(f)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(f"guarddog.{name}")
    if not any(isinstance(f, RawUrlRedactionFilter) for f in logger.filters):
        logger.addFilter(RawUrlRedactionFilter())
    return logger
