"""Authoritative Apollo product knowledge for Higgins.

Higgins is the savant of Apollo and of scams. That requires one written source of
truth about the product itself: what every screen is, where it lives, what each
check does, how the flows work and what the privacy rules are. This module is
that source.

Exports:

* ``knowledge_block(modules)`` — curated text injected into Higgins turns, with
  only the classifier-selected modules included.  The permanent core (roles,
  protection names) is always present; conditional modules are included when
  the classifier determines the question needs them.
* ``NAV_ROUTES`` / ``valid_route()`` — the deep-link allow-list, always complete
  regardless of which modules the prompt includes.
* ``ROUTE_GROUPS`` — the segmented route registry used by the classifier.

The route strings mirror the Expo Router file tree in ``frontend/app``. Keep the
two in step: a route removed from the app must be removed here, or Higgins will
offer a tap that goes nowhere.
"""
from __future__ import annotations

from typing import Sequence

# ── Deep-link allow-list ─────────────────────────────────────────────────────
# route → the words a person would tap. Dynamic routes (/patrol/[id] and the
# like) are deliberately absent: they need an id Higgins does not hold.

NAV_ROUTES: dict[str, str] = {
    # Main tabs
    "/(tabs)/home": "Home",
    "/(tabs)/patrol": "Threats",
    "/(tabs)/scams": "Scam Alerts",
    "/(tabs)/ask": "Higgins",
    "/(tabs)/settings": "Settings",
    "/(tabs)/check-it": "Check It",
    "/(tabs)/guard": "Your protections",
    # Manual checks
    "/message": "Check a message",
    "/check": "Check a website link",
    "/file": "Check a file",
    "/call-guard": "Check a number",
    "/scan": "Scan a code",
    "/email": "Check an email",
    "/app-check": "Check an app",
    "/account": "Check an account alert",
    "/device": "Check my device",
    "/device-protection": "Device capabilities",
    "/network": "Check my internet",
    "/vision": "Check a screenshot",
    "/text-guard": "Message screening",
    "/recheck": "Re-check my device",
    # Records and history
    "/patrol/history": "Threat history",
    "/saved-checks": "Saved checks",
    "/saved-reports": "Saved reports",
    "/higgins/history": "Conversation history",
    "/app-reports": "App reports",
    "/digest": "Weekly digest",
    "/account-monitor": "Account monitoring",
    # Learning and alerts
    "/higgins/learning": "Learn with Higgins",
    "/higgins/scams": "Scam Alerts",
    # Protections
    "/gates": "All protections",
    # Settings and policies
    "/settings/personal-data": "My personal data",
    "/settings/email-accounts": "Email accounts",
    "/privacy-data": "What Apollo stores",
    "/privacy-disclosure": "Privacy statement",
    "/third-party-register": "Third-party services",
    "/compliance-matrix": "Compliance matrix",
    "/notification-check": "Notification check",
    "/family": "Family sharing",
    "/support": "Get help with Apollo",
}


def valid_route(route: str) -> bool:
    """True when the route is a real Apollo destination Higgins may offer."""
    return route in NAV_ROUTES


def route_label(route: str) -> str:
    return NAV_ROUTES.get(route, "")


# ── Route groups (classifier picks relevant slices) ──────────────────────────

ROUTE_GROUPS: dict[str, dict[str, str]] = {
    "tabs": {
        "/(tabs)/home": "Home — protection status, recent activity",
        "/(tabs)/patrol": "Threats — every threat found or checked",
        "/(tabs)/scams": "Scam Alerts — government feed campaigns",
        "/(tabs)/ask": "Higgins — this conversation",
        "/(tabs)/settings": "Settings — everything configurable",
        "/(tabs)/check-it": "Check It — hub for all manual checks",
        "/(tabs)/guard": "Your protections — every protection and its real status",
    },
    "checks": {
        "/message": "Check a message — paste, share or screenshot",
        "/check": "Check a website link — see where it really goes",
        "/file": "Check a file — a download or attachment",
        "/call-guard": "Check a number — who called, scam check, call screener setup",
        "/scan": "Scan a code — QR code or barcode",
        "/email": "Check an email — plus connect Gmail for ongoing checking",
        "/app-check": "Check an app — installed or being considered",
        "/account": "Check an account alert — login/breach/recovery warning",
        "/device": "Check my device — screen lock, biometrics, OS updates",
        "/device-protection": "Device capabilities — what this device protects by itself, what Apollo may use, what the OS withholds, and which native settings to turn on",
        "/network": "Check my internet — current Wi-Fi or mobile connection",
        "/vision": "Check a screenshot — any picture of something suspicious",
        "/text-guard": "Message screening — paste text or turn on auto-screening (Android)",
        "/recheck": "Re-check my device — repeat checks and compare",
    },
    "records": {
        "/patrol/history": "Threat history — full record including resolved",
        "/saved-checks": "Saved checks — kept with original analysis",
        "/saved-reports": "Saved reports — completed Magnum DI briefings on this phone",
        "/higgins/history": "Conversation history — past Higgins conversations",
        "/app-reports": "App reports — results of app checks",
        "/digest": "Weekly digest — the week in one summary",
        "/account-monitor": "Account monitoring — email breach monitoring (weekly)",
    },
    "settings": {
        "/(tabs)/settings": "Settings — seven groups below",
        "/gates": "View all protections — every protection and its real status",
        "/notification-check": "Notification check",
        "/settings/email-accounts": "Email accounts",
        "/family": "Family sharing",
        "/settings/personal-data": "My personal data",
        "/privacy-data": "What Apollo stores",
        "/privacy-disclosure": "Privacy statement",
        "/third-party-register": "Third-party services",
        "/compliance-matrix": "Compliance matrix",
        "/support": "Get help with Apollo",
    },
    "learning": {
        "/higgins/learning": "Learn with Higgins — article library on scams",
        "/higgins/scams": "Scam Alerts — government feeds",
    },
}


def _render_route_group(name: str) -> str:
    """Render one route group as compact text."""
    routes = ROUTE_GROUPS.get(name, {})
    if not routes:
        return ""
    lines = [f"{name.upper()} ROUTES:"]
    for route, desc in routes.items():
        lines.append(f"- `{route}` — {desc}")
    return "\n".join(lines)


# ── Knowledge modules ────────────────────────────────────────────────────────
# Each module is a named block of product knowledge. The permanent core is
# always included; conditional modules are included when the classifier says so.

# PERMANENT: role separation (always in prompt — safety invariant)
_ROLES = """WHO DOES WHAT — NEVER BLUR THESE:
- APOLLO: protection and detection. Watches, detects, blocks, records. Acts on the device.
- MAGNUM DI: investigation and external searching. Examines evidence, searches sources, produces the full briefing. You do NOT investigate or search externally.
- HIGGINS (you): knows this app completely and knows scams. Explains, guides, navigates, hands off. When investigation is needed, say so and hand to Magnum DI."""

# PERMANENT: protection names (always needed for snapshot interpretation)
_PROTECTION_NAMES = """USER-FACING PROTECTIONS:
- Websites & Links — automatic blocking + manual link checking
- Messages & Calls — message screening + call/number risk checks
- Email & Accounts — email monitoring + account compromise checks
- Apps & Files — app and file safety checks
- Device & Internet — device settings + network monitoring
- Vision — photograph/screenshot safety checks
A 'ready' or 'manual checks available' gate is NOT offline. Only 'offline' or 'unavailable/service_down' means offline."""

# CONDITIONAL: screens and routes (classifier picks relevant groups)
def _screens_block(route_groups: Sequence[str]) -> str:
    """Build the screens/routes section from classifier-selected groups."""
    if not route_groups:
        return ""
    parts = ["APOLLO DESTINATIONS (selected for this question):"]
    for group in route_groups:
        rendered = _render_route_group(group)
        if rendered:
            parts.append(rendered)
    parts.append("Only offer routes from the list above. At most two per answer, only when the destination genuinely answers the question.")
    return "\n\n".join(parts)

# CONDITIONAL: how flows work
_FLOWS = """HOW APOLLO'S FLOWS WORK:
- Sharing into Apollo: use Share from any app, choose Apollo. Apollo asks which app, shows what it received, waits for confirmation.
- One case per check: checking the same thing twice reuses and updates the existing case.
- Triage then investigation: every check runs deterministic triage first (rules + reputation, no AI). If clean, that's the answer. If possible threat or inconclusive, escalates to full Magnum DI investigation.
- Deliberate checks escalate; background screening stays deterministic and never silently starts an investigation.
- Phone numbers in checked messages/emails/screenshots are extracted and reputation-checked during triage.
- Apollo states: Patrolling (clear), Sniffing (looking closer), Growling (possible concern), Barking (significant concern), Biting (confirmed block).
- Setup: welcome → privacy statement → turn on protections → first check.
- Evidence on-device: original item + redacted analysis copy, viewable side by side."""

# CONDITIONAL: privacy rules
_PRIVACY = """APOLLO'S PRIVACY RULES (state accurately):
- No account, no email, no ad tracking. Anonymous device ID only.
- Checks run on-device first. Only what the assessment needs leaves the device, only for that one assessment.
- Credentials, verification codes, secret URL fragments stripped before sending.
- Cases keep summary and safe references — not full messages, screenshots, files or tokens.
- Conversations and speech: encrypted, max 15 minutes on server. Clearing temporary history invalidates immediately.
- Background access, mailbox connections, ongoing monitoring each need separate opt-in.
- Phone number shared only if added for family calling.
- Full details: Privacy statement `/privacy-disclosure`, What Apollo stores `/privacy-data`, Third-party services `/third-party-register`."""

# CONDITIONAL: call screening detail
_CALL_SCREENING = """CALL SCREENING:
- Android: Apollo can become default call screener via Settings > Default apps > Caller ID & spam blocking. Offered during setup and on Check a number `/call-guard`.
- iOS: Apple provides no equivalent. No app can be the call screener. Apollo works from numbers the person checks and a blocked-number list. Say this plainly; never imply parity."""

# CONDITIONAL: settings structure
_SETTINGS_DETAIL = """SETTINGS `/(tabs)/settings` — seven groups:
1. Protection — View all protections `/gates`.
2. Alerts — notification permission, Notification check, alert preview, quiet hours.
3. Accounts & family — Email accounts, Family sharing, trusted links.
4. Your data — Personal data, What Apollo stores, clear Threat history.
5. App — battery saver, minimise Apollo, retrofit past investigations.
6. Help & about — Get help, how to share into Apollo, About Apollo.
7. Policies — Privacy statement, Third-party services, Compliance matrix."""


# ── Module registry ──────────────────────────────────────────────────────────
# Keys match what the classifier returns in knowledge_modules.

KNOWLEDGE_MODULES: dict[str, str] = {
    "flows": _FLOWS,
    "privacy": _PRIVACY,
    "call_screening": _CALL_SCREENING,
    "settings_detail": _SETTINGS_DETAIL,
}


def knowledge_block(
    modules: Sequence[str] = (),
    route_groups: Sequence[str] = (),
) -> str:
    """Build the Apollo knowledge section for the Higgins prompt.

    Args:
        modules: Which conditional knowledge modules to include (e.g. ["flows", "privacy"]).
        route_groups: Which route groups to include (e.g. ["checks", "settings"]).

    The permanent core (_ROLES, _PROTECTION_NAMES) is always included regardless
    of the arguments.
    """
    parts: list[str] = [
        "=== APOLLO PRODUCT KNOWLEDGE (authoritative) ===",
        _ROLES,
        _PROTECTION_NAMES,
    ]

    # Conditional route groups
    screens = _screens_block(route_groups)
    if screens:
        parts.append(screens)

    # Conditional knowledge modules
    for mod in modules:
        text = KNOWLEDGE_MODULES.get(mod)
        if text:
            parts.append(text)

    parts.append("=== END APOLLO PRODUCT KNOWLEDGE ===")
    return "\n\n".join(parts)
