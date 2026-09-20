"""P0 policy stop: no raw messages/images/mailboxes or caller identifiers in cloud checks.

Routes/contracts remain registered for compatibility; forbidden operations fail explicitly
BEFORE reading the request body or starting an OAuth/provider request. Disconnect stays usable.
"""
from starlette.responses import JSONResponse

DISABLED = {
    '/api/message/extract', '/api/page/extract', '/api/page/crawl',
    '/api/gmail/connect', '/api/gmail/oauth/callback', '/api/gmail/scan',
    '/api/imap/connections', '/api/imap/scan', '/api/call/risk-check',
    '/api/account/breach',
}
DETAIL = 'Unavailable under Apollo’s local-first privacy policy. Use an on-device check instead.'


class PrivacyBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope.get('path', '').rstrip('/') in DISABLED:
            await JSONResponse({'detail': DETAIL}, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)