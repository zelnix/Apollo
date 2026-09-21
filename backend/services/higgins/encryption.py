"""Dedicated investigation-content key; never use an API or Gmail encryption key."""
import os
import hashlib
import hmac
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()


@lru_cache(maxsize=1)
def cipher() -> Fernet:
    path = os.getenv("INVESTIGATION_KEY_FILE", "")
    if not path:
        raise HTTPException(503, 'Investigation encryption is not configured.')
    key_file = Path(path)
    if not key_file.is_file():
        raise HTTPException(503, 'The dedicated investigation encryption key file is unavailable.')
    if key_file.stat().st_mode & 0o077:
        raise RuntimeError("investigation_key_permissions_invalid")
    return Fernet(key_file.read_bytes().strip())


def encrypt(content: str | bytes) -> str:
    data = content.encode("utf-8") if isinstance(content, str) else content
    return cipher().encrypt(data).decode("ascii")


def decrypt(content: str) -> bytes:
    return cipher().decrypt(content.encode("ascii"))


def payload_digest(content: str) -> str:
    # Domain-separated integrity key; never reuse a Gemini/Gmail credential or expose a public hash.
    root = Path(os.environ['INVESTIGATION_KEY_FILE']).read_bytes().strip()
    key = hmac.new(root, b'apollo-investigation-turn-integrity-v1', hashlib.sha256).digest()
    return hmac.new(key, content.encode('utf-8'), hashlib.sha256).hexdigest()