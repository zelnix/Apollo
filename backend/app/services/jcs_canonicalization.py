"""RFC 8785 (JCS) canonicalization.

We do NOT hand-roll canonical JSON: the `rfc8785` package is a
standards-conformant implementation. Its output bytes are the ground truth that
the Kotlin (erdtman/java-json-canonicalization), Swift and TypeScript verifiers
must match byte-for-byte (see security/test-vectors/jcs/canonical_bytes.hex).

Rule-bundle envelopes are additionally constrained by schema to strings,
integers, booleans, arrays and objects (no floats), so the JCS number
formatting corner cases are never exercised by a valid bundle.
"""
from __future__ import annotations

from typing import Any

import rfc8785


def canonical_bytes(value: Any) -> bytes:
    return rfc8785.dumps(value)


def canonical_hex(value: Any) -> str:
    return canonical_bytes(value).hex()
