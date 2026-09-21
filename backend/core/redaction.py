"""Request-boundary redaction for user login secrets."""
import re

_SECRET = re.compile(
    r"(?i)\b(password|passcode|p\.?i\.?n\.?|otp|one[- ]time(?: security)? code|verification code|security code|recovery code|username|login id)\b"
    r"(\s*(?:is|was|:|=)\s*|\s+)([A-Za-z0-9!@#$%^&*_.+\-/]{3,96})"
)
_NON_SECRET_WORDS = {"reset", "change", "changed", "request", "requested", "prompt", "field", "link", "page", "screen", "required",
                     "with", "without", "from", "using", "manager", "management", "sharing", "protection", "protected", "never", "should", "must"}
_IPV4 = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
_IPV6 = re.compile(r"\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b", re.I)


def redact_user_secrets(value: str) -> str:
    """Preserve the risk context while discarding the submitted secret value."""
    def replace(match: re.Match[str]) -> str:
        if match.group(3).lower() in _NON_SECRET_WORDS and not re.search(r'[:=]', match.group(2)):
            return match.group(0)
        return f"{match.group(1)}{match.group(2)}[redacted]"
    return _IPV6.sub("[ip address]", _IPV4.sub("[ip address]", _SECRET.sub(replace, value)))


def redact_investigation_secrets(value: str) -> str:
    """Private purpose-limited evidence retains relevant phone/email/IP identifiers, never secrets."""
    def replace(match: re.Match[str]) -> str:
        return match.group(0) if match.group(3).lower() in _NON_SECRET_WORDS and not re.search(r'[:=]', match.group(2)) else f"{match.group(1)}{match.group(2)}[redacted]"
    value = _SECRET.sub(replace, value)
    value = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", value)
    value = re.sub(r"(?i)([?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session|signature)=)[^\s&#\"']+", r"\1[redacted]", value)
    return re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[redacted]@", value)