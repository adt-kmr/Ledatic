"""
Citadel — Active Deception & HoneyTrap service
==================================================

Central logic for the deception layer (Phase 1 of the Advanced Cybersecurity
modules). Two trap surfaces feed this service:

  A. DOM form-field honeypots — an invisible input a human never sees but an
     automated bot / naive password-manager fills. The frontend reports the
     fill to POST /api/security/honeypot/report.

  B. Decoy "honey" API endpoints (e.g. /api/v1/debug/dump_keys) that no
     legitimate client ever calls. Any hit is, by definition, reconnaissance.

When a trap fires we:
  1. Blacklist the client IP in Redis for 24h  (persistent, cross-worker).
  2. Broadcast a threat event to the FIU Fraud-Ops panel over an in-process
     pub/sub hub (SSE) AND Redis pub/sub (best-effort, for multi-worker).
  3. Force the session's composite risk to 1000 (HARD_BLOCK) at the caller.

Design rules:
  - Fully additive & graceful: if Redis is down, blacklisting degrades to an
    in-process set and the app keeps serving. A trap NEVER raises out of the
    hot path unless the caller explicitly wants a 403.
  - No PII: only the client IP (already available to the server) and a coarse
    reason code are stored/broadcast.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

BLACKLIST_TTL_SECONDS = 24 * 60 * 60          # 24 hours
BLACKLIST_KEY = "deception:blacklist:{ip}"
THREAT_CHANNEL = "cbi_threat_channel"          # Redis pub/sub channel name
MAX_EVENT_BACKLOG = 200                          # ring buffer for late SSE subscribers

# Decoy endpoints an attacker probes but no real client ever touches.
DECOY_PATHS = {
    "/api/v1/debug/dump_keys",
    "/api/v1/admin/export_users",
    "/api/v1/internal/config",
    "/.env",
    "/api/v1/admin/backup.sql",
}


@dataclass
class ThreatEvent:
    """A single deception/intrusion event surfaced to the FIU panel."""
    kind: str                      # "DOM_HONEYPOT" | "DECOY_API" | "BLACKLIST_HIT"
    client_ip: str
    reason: str
    path: Optional[str] = None
    session_id: Optional[str] = None
    ts: float = field(default_factory=lambda: time.time())

    def to_dict(self) -> dict:
        return {
            "type": "deception_trap",
            "kind": self.kind,
            "client_ip": self.client_ip,
            "reason": self.reason,
            "path": self.path,
            "session_id": self.session_id,
            "severity": "CRITICAL",
            "risk_score": 1000,
            "timestamp": self.ts,
        }


class ThreatBroadcaster:
    """In-process fan-out hub so the SSE endpoint(s) get trap events instantly.

    Each SSE connection calls subscribe() to get its own bounded queue. Publish
    is non-blocking: a slow/backed-up subscriber drops the oldest event rather
    than stalling the trap path. A small ring buffer lets a panel that connects
    a moment later still catch very recent events.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._recent: list[dict] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def recent(self) -> list[dict]:
        return list(self._recent)

    def publish(self, event: dict) -> None:
        self._recent.append(event)
        if len(self._recent) > MAX_EVENT_BACKLOG:
            self._recent = self._recent[-MAX_EVENT_BACKLOG:]
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the oldest queued event to make room; never block a trap.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass


# Module-level singletons ------------------------------------------------------
_broadcaster = ThreatBroadcaster()
# In-process blacklist fallback used only when Redis is unavailable.
_local_blacklist: dict[str, float] = {}


def get_broadcaster() -> ThreatBroadcaster:
    return _broadcaster


async def blacklist_ip(client_ip: str, reason: str) -> None:
    """Blacklist an IP for 24h. Redis-backed, with an in-process fallback."""
    if not client_ip:
        return
    r = get_redis()
    if r is not None:
        try:
            await r.setex(BLACKLIST_KEY.format(ip=client_ip), BLACKLIST_TTL_SECONDS, reason)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis blacklist write failed (%s) — using local fallback", exc)
            _local_blacklist[client_ip] = time.time() + BLACKLIST_TTL_SECONDS
    else:
        _local_blacklist[client_ip] = time.time() + BLACKLIST_TTL_SECONDS


async def is_blacklisted(client_ip: str) -> bool:
    """True if the IP is currently blacklisted (checks Redis then local fallback)."""
    if not client_ip:
        return False
    r = get_redis()
    if r is not None:
        try:
            if await r.exists(BLACKLIST_KEY.format(ip=client_ip)):
                return True
        except Exception as exc:  # noqa: BLE001
            logger.debug("Redis blacklist read failed: %s", exc)
    exp = _local_blacklist.get(client_ip)
    if exp is not None:
        if exp > time.time():
            return True
        _local_blacklist.pop(client_ip, None)
    return False


async def trigger_trap(
    kind: str,
    client_ip: str,
    reason: str,
    *,
    path: Optional[str] = None,
    session_id: Optional[str] = None,
) -> ThreatEvent:
    """Fire a deception trap: blacklist + broadcast. Returns the event.

    This is the single entry point used by both the DOM-honeypot report handler
    and the decoy-API handlers so behaviour stays identical across surfaces.
    """
    event = ThreatEvent(kind=kind, client_ip=client_ip, reason=reason, path=path, session_id=session_id)
    await blacklist_ip(client_ip, reason)

    payload = event.to_dict()
    _broadcaster.publish(payload)

    # Best-effort cross-worker fan-out (single-worker demo doesn't need it).
    r = get_redis()
    if r is not None:
        try:
            import json
            await r.publish(THREAT_CHANNEL, json.dumps(payload))
        except Exception as exc:  # noqa: BLE001
            logger.debug("Redis publish skipped: %s", exc)

    logger.warning("🪤 DECEPTION TRAP [%s] ip=%s reason=%s path=%s", kind, client_ip, reason, path)
    return event


def client_ip_from_request(request) -> str:
    """Resolve the real client IP, honouring X-Forwarded-For (Render/Vercel proxy)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First hop is the original client.
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""
