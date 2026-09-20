from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import imapmail


@pytest.mark.asyncio
async def test_private_imap_target_is_rejected_before_socket_open():
    with pytest.raises(HTTPException) as raised:
        await imapmail.test_connection("127.0.0.1", 993, True, "user", "password")
    assert raised.value.status_code == 400
    assert "public target" in str(raised.value.detail)


@pytest.mark.asyncio
async def test_imap_requires_verified_tls_port_993():
    with pytest.raises(HTTPException) as raised:
        await imapmail.test_connection("example.com", 143, False, "user", "password")
    assert raised.value.status_code == 400
    assert "TLS on port 993" in str(raised.value.detail)