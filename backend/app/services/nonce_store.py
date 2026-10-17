"""
Citadel — Single-use nonce store (replay resistance)
========================================================

Issues short-lived, single-use nonces bound to an ephemeral HMAC session key.
Backed by Redis (cross-worker, TTL) with an in-process fallback so the feature
works even when Redis is down (e.g. Render free tier). `consume` is atomic-ish:
it reads then deletes, so a replayed bundle re-using a spent nonce is rejected.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Optional

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

NONCE_TTL_SECONDS = 120
_KEY = "antispoof:nonce:{nonce}"

# Local fallback: nonce -> (session_key, expires_at)
_local: dict[str, tuple[str, float]] = {}


def _sweep_local() -> None:
    now = time.time()
    for k, (_, exp) in list(_local.items()):
        if exp <= now:
            _local.pop(k, None)


async def issue() -> dict:
    """Create a fresh nonce + session key. Returns {nonce, session_key, ttl}."""
    nonce = secrets.token_hex(16)
    session_key = secrets.token_hex(32)
    r = get_redis()
    if r is not None:
        try:
            await r.setex(_KEY.format(nonce=nonce), NONCE_TTL_SECONDS, session_key)
        except Exception as exc:  # noqa: BLE001
            logger.debug("nonce redis write failed, using local: %s", exc)
            _local[nonce] = (session_key, time.time() + NONCE_TTL_SECONDS)
    else:
        _local[nonce] = (session_key, time.time() + NONCE_TTL_SECONDS)
    return {"nonce": nonce, "session_key": session_key, "ttl": NONCE_TTL_SECONDS}


async def consume(nonce: str) -> Optional[str]:
    """Return the session_key for a valid, unspent nonce and mark it spent.
    Returns None if the nonce is unknown, expired, or already consumed (replay).
    """
    if not nonce:
        return None
    r = get_redis()
    if r is not None:
        try:
            key = _KEY.format(nonce=nonce)
            session_key = await r.get(key)
            if session_key is None:
                return None
            await r.delete(key)  # single-use: spend it
            return session_key
        except Exception as exc:  # noqa: BLE001
            logger.debug("nonce redis consume failed, checking local: %s", exc)
    _sweep_local()
    entry = _local.pop(nonce, None)  # pop = atomic spend in-process
    if entry is None:
        return None
    session_key, exp = entry
    if exp <= time.time():
        return None
    return session_key
