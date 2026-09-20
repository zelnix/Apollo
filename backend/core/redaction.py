"""Request-boundary redaction for user login secrets."""
import re

_SECRET = re.compile(
    r"(?i)\b(password|passcode|p\.?i\.?n\.?|otp|one[- ]time(?: security)? code|verification code|security code|recovery code|username|login id)\b"
    r"(\s*(?:is|was|:|=)\s*|\s+)([A-Za-z0-9!@#$%^&*_.+\-/]{3,96})"
)
_NON_SECRET_WORDS = {"reset", "change", "changed", "request", "requested", "prompt", "field", "link", "page", "screen", "required"}


def redact_user_secrets(value: str) -> str:
    """Preserve the risk context while discarding the submitted secret value."""
    def replace(match: re.Match[str]) -> str:
        if match.group(3).lower() in _NON_SECRET_WORDS:
            return match.group(0)
        return f"{match.group(1)}{match.group(2)}[redacted]"
    return _SECRET.sub(replace, value)