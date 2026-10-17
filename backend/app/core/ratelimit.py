"""
In-memory sliding-window rate limiter for the auth surface.

Single-process by design (each worker keeps its own window) — good enough to
stop credential stuffing against the demo deployment without adding a Redis
round-trip to every login. Keyed by client IP + scope.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request

# scope:ip → timestamps of recent hits (monotonic seconds)
_hits: Dict[str, Deque[float]] = defaultdict(deque)

# Stop the map growing without bound: prune whole buckets opportunistically.
_MAX_BUCKETS = 10_000


def _client_ip(request: Request) -> str:
    """Client IP, honouring the first X-Forwarded-For hop set by the proxy."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def rate_limit(times: int, seconds: int, scope: str):
    """Dependency factory: allow at most `times` calls per `seconds` per IP."""

    async def _guard(request: Request) -> None:
        now = time.monotonic()
        key = f"{scope}:{_client_ip(request)}"
        window = _hits[key]
        cutoff = now - seconds
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= times:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "message": "Too many attempts — try again shortly.",
                },
            )
        window.append(now)
        if len(_hits) > _MAX_BUCKETS:
            for k in [k for k, v in _hits.items() if not v or v[-1] <= cutoff][:1000]:
                _hits.pop(k, None)

    return _guard
