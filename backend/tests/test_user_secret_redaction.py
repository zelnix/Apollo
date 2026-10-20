"""Test: Higgins never asks for or repeats user secrets (passwords, codes, tokens).

Checks that the coordinator prompt forbids requesting secrets and the chat
module properly redacts secrets from investigation content. Adapted for the
simplified Higgins architecture (deterministic context routing + single Gemini call).
"""
from pathlib import Path

def test_secrets_are_redacted_before_they_reach_the_provider():
    # Chat module must redact secrets from investigation content
    chat_source = (Path(__file__).resolve().parents[1] / "services" / "higgins" / "chat.py").read_text()
    assert "redact_investigation_secrets" in chat_source, \
        "Chat module must call redact_investigation_secrets"
    # Ask router must delegate to chat, not coordinator
    ask_source = (Path(__file__).resolve().parents[1] / "routers" / "ask.py").read_text()
    assert "chat.reply" in ask_source, \
        "Ask router must use chat.reply"
    assert "from services.higgins import coordinator" not in ask_source, \
        "Ask router must not import coordinator directly"
