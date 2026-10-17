import json
import time
import logging
from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.models.schemas import SignalBundle, SignalIngestResponse
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)
router = APIRouter()

# Same cap the ML service applies per event type (ml/main.py MAX_EVENTS_PER_TYPE).
MAX_EVENTS_PER_TYPE = 5000


@router.post("/ingest", response_model=SignalIngestResponse)
async def ingest_signals(
    bundle: SignalBundle,
    redis: Redis = Depends(get_redis),
):
    """Pre-auth signal ingest — captures behavioral signals BEFORE login submit.

    Deliberately Redis-only: the signal buffer is keyed by session_id (a UUID
    the SDK generates), NOT by user_id. We do NOT auto-create User/Passport rows
    here — that was a poisoning vector (an unauthenticated caller could create
    users/passports for arbitrary user_ids and merge events into a victim's
    buffer). User/passport rows are created only at /api/auth/evaluate, which is
    authenticated and binds the identity to the JWT caller.
    """
    # ── Redis: accumulate signals across flushes (merge, don't overwrite) ───
    # Each SDK flush sends only the latest batch. We merge into a cumulative
    # bundle so the ML preview and evaluate always see the FULL session history.
    key = f"session:{bundle.session_id}:signals"
    incoming = bundle.model_dump()

    existing_raw = await redis.get(key)
    if existing_raw:
        try:
            existing = json.loads(existing_raw)
            # Extend each signal list with the new batch
            # Keep only the newest events — matches the ML service's own
            # per-type cap, so scoring is unchanged while the Redis value (which
            # is rewritten on every 500 ms flush) stays bounded.
            for field in ("keystroke_events", "mouse_events", "touch_events", "navigation_events"):
                combined = (existing.get(field) or []) + (incoming.get(field) or [])
                existing[field] = combined[-MAX_EVENTS_PER_TYPE:]
            # Always use latest environment + metadata
            existing["environment"]   = incoming.get("environment", existing.get("environment"))
            existing["timestamp_ms"]  = incoming.get("timestamp_ms", existing.get("timestamp_ms"))
            merged = existing
        except Exception:
            merged = incoming
    else:
        merged = incoming

    await redis.setex(key, 3600, json.dumps(merged))
    await redis.zadd("active_sessions", {bundle.session_id: time.time()})

    # Update or create the live_session cache for the telemetry dashboard
    live_key = f"live_session:{bundle.session_id}"
    live_raw = await redis.get(live_key)
    
    ks_len = len(merged.get("keystroke_events") or merged.get("keystrokeEvents") or [])
    mouse_len = len(merged.get("mouse_events") or merged.get("mouseEvents") or [])
    touch_len = len(merged.get("touch_events") or merged.get("touchEvents") or [])
    
    if live_raw:
        try:
            live_data = json.loads(live_raw.decode() if isinstance(live_raw, bytes) else live_raw)
            live_data["signals"] = {
                "ks": ks_len,
                "mouse": mouse_len,
                "touch": touch_len,
            }
            if bundle.user_id and bundle.user_id != "anonymous" and bundle.user_id != "demo-user-harshdeep":
                live_data["user_id"] = bundle.user_id
            live_data["timestamp"] = time.time()
            await redis.set(live_key, json.dumps(live_data), ex=300)
        except Exception:
            pass
    else:
        # Create draft live session state so it immediately shows up as active
        draft_state = {
            "session_id": bundle.session_id,
            "user_id": bundle.user_id or "anonymous",
            "risk_score": 0,
            "decision": "APPROVE",
            "pathway": "ML_FULL",
            "coercion_probability": 0.0,
            "on_chain_verified": False,
            "latency_ms": 0,
            "reason": "Telemetry streaming...",
            "signals": {
                "ks": ks_len,
                "mouse": mouse_len,
                "touch": touch_len,
            },
            "timestamp": time.time(),
        }
        await redis.set(live_key, json.dumps(draft_state), ex=300)

    return SignalIngestResponse(session_id=bundle.session_id)
