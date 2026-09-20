"""Route-level privacy boundary for operations with no supported purpose-limited implementation.

User-submitted assessment routes are now governed by their request schemas, bounded transports and
request-scoped deletion controls rather than a blanket local-only ban.
"""
from starlette.responses import JSONResponse

DISABLED = {
}
DETAIL = 'This operation has no supported purpose-limited processing path.'


class PrivacyBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope.get('path', '').rstrip('/') in DISABLED:
            await JSONResponse({'detail': DETAIL}, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)