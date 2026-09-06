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


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    redaction = RawUrlRedactionFilter()
    for name in ("", "guarddog", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, RawUrlRedactionFilter) for f in logger.filters):
            logger.addFilter(redaction)
        for handler in logger.handlers:
            if not any(isinstance(f, RawUrlRedactionFilter) for f in handler.filters):
                handler.addFilter(redaction)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(f"guarddog.{name}")
    if not any(isinstance(f, RawUrlRedactionFilter) for f in logger.filters):
        logger.addFilter(RawUrlRedactionFilter())
    return logger
