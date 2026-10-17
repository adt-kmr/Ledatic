"""
Fraud-analyst account-block Redis mirror, shared by the admin panel (writes)
and the /evaluate hot path (reads).

Source of truth = the `customer_block` DB row. The Redis mirror `blocked:{user_hash}`
drives /evaluate so enforcement adds no DB round-trip to login. The mirror is
(re)set on every block/unblock here — the single place that owns the key format,
so the reader (auth.py) and the writer (admin.py) can never drift.

The READ side lives inline in auth.py /evaluate rather than here, because the hot
path must avoid opening a DB session unless Redis is actually unavailable (Redis
reachable + key absent = not blocked; only a Redis *failure* triggers the DB
fallback). admin.py reads the DB row directly since it already holds a session.
"""
from __future__ import annotations

import logging
from typing import Optional

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

_BLOCKED_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days — admin blocks are rare; keep the mirror warm


def blocked_key(user_hash: str) -> str:
    return f"blocked:{user_hash}"


async def mirror_block(redis: Redis, user_hash: str, reason: Optional[str]) -> None:
    """Set the Redis mirror so /evaluate blocks the customer on the very next call."""
    try:
        value = f"blocked:{reason}" if reason else "blocked"
        await redis.set(blocked_key(user_hash), value, ex=_BLOCKED_TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not mirror block in Redis: %s", exc)


async def mirror_unblock(redis: Redis, user_hash: str) -> None:
    """Clear the Redis mirror so /evaluate stops blocking the customer immediately."""
    try:
        await redis.delete(blocked_key(user_hash))
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not clear block mirror in Redis: %s", exc)