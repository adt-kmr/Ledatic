"""
Citadel — Blacklist & Decoy interception middleware
=======================================================

Runs before every request. Two jobs:

  1. If the client IP is on the deception blacklist, short-circuit with 403
     (they tripped a honeypot in the last 24h — no reason to serve them).

  2. If the request path is a known decoy ("honey") endpoint, fire the trap
     (blacklist + broadcast) and return a plausible 403 so the attacker cannot
     tell a decoy from a real protected route.

Kept intentionally thin and fail-open: any internal error in the middleware
must never take down a legitimate request, so the whole body is guarded.
"""
from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.services.deception import (
    DECOY_PATHS,
    client_ip_from_request,
    is_blacklisted,
    trigger_trap,
)

logger = logging.getLogger(__name__)

_BLOCK_BODY = {"detail": "Security Violation: Host Blacklisted."}

# Paths a blocked host must still reach — notably the un-blacklist reset, so a
# demo can never lock itself out permanently, plus health checks.
#
# /api/admin/login is exempt too: the reset endpoint requires a fresh admin
# bearer token, and without this a blacklisted admin could never obtain one,
# making the "always reachable" reset above unreachable in practice — a real
# self-lockout with no recovery path. Admin login is already separately
# rate-limited (see admin.py), so this doesn't materially widen the attack
# surface the blacklist protects against.
_EXEMPT_PATHS = {"/api/security/deception/reset", "/api/admin/login", "/health"}


class DeceptionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            ip = client_ip_from_request(request)
            path = request.url.path

            if path in _EXEMPT_PATHS:
                return await call_next(request)

            # 2. Decoy endpoint hit → trap + 403 (checked before blacklist so
            #    the very first probe is recorded).
            if path in DECOY_PATHS:
                await trigger_trap("DECOY_API", ip, f"decoy endpoint probed: {path}", path=path)
                return JSONResponse(status_code=403, content=_BLOCK_BODY)

            # 1. Already-blacklisted IP → block everything.
            if await is_blacklisted(ip):
                return JSONResponse(status_code=403, content=_BLOCK_BODY)
        except Exception as exc:  # noqa: BLE001 — fail open, never break real traffic
            logger.debug("DeceptionMiddleware bypassed on error: %s", exc)

        return await call_next(request)
