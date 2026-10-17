"""
Per-customer Trust / Security Score for the FIU admin panel.

A transparent, explainable 0–100 score (higher = more trustworthy) built ONLY
from real signals the platform already records — no mock/telecom data. It is a
weighted sum of five named sub-factors, each returned with its own contribution
and a human-readable detail, so the score is auditable (RBI FREE-AI), never a
black box.

Weights (sum = 100):
  Enrollment            25   fraction of channels with a completed biometric baseline
  Behavioral consistency 30  1 − (flagged sessions / recent sessions)
  Coercion safety       15   1 − peak recent coercion probability
  Account standing      20   20 − 5·(recent login failures), floored at 0
  Device integrity      10   registered IMEI baseline present

A currently-blocked account is capped low (a blocked account cannot be trusted).
Zero-session accounts are marked `provisional` (score reflects only enrollment +
device, which is honest rather than falsely confident).
"""
from __future__ import annotations

import logging

from redis.asyncio import Redis
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import derive_user_hash
from app.models.db_models import BehavioralPassport, CustomerBlock, Session as DBSession, User

logger = logging.getLogger(__name__)

ALL_CHANNELS = 3          # UPI, MOBILE, INTERNET
RECENT_N = 25             # sessions considered "recent"


async def compute_trust(db: AsyncSession, redis: Redis, user: User) -> dict:
    # ── Enrollment (25) ──────────────────────────────────────────────
    passports = (await db.execute(
        select(BehavioralPassport).where(BehavioralPassport.user_id == user.id)
    )).scalars().all()
    enrolled = sum(1 for p in passports if p.is_enrolled)
    enroll_pts = round(min(enrolled, ALL_CHANNELS) / ALL_CHANNELS * 25, 1)

    # ── Behavioral consistency (30) + Coercion safety (15) ───────────
    sessions = (await db.execute(
        select(DBSession).where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at)).limit(RECENT_N)
    )).scalars().all()
    total = len(sessions)
    anomalies = sum(1 for s in sessions if s.decision in ("STEP_UP", "HARD_BLOCK"))
    anomaly_rate = (anomalies / total) if total else 0.0
    behav_pts = round((1 - anomaly_rate) * 30, 1) if total else 0.0
    max_coercion = max((s.coercion_probability or 0.0 for s in sessions), default=0.0)
    coercion_pts = round((1 - min(max_coercion, 1.0)) * 15, 1)

    # ── Account standing (20) + Device integrity (10) ────────────────
    # login_failures / imei_baseline live in Redis keyed by the derived HMAC.
    user_hash = derive_user_hash(user.bank_id, user.customer_hash)
    try:
        raw = await redis.get(f"login_failures:{user_hash}")
        failures = int(raw) if raw else 0
        imei = bool(await redis.exists(f"imei_baseline:{user_hash}"))
    except Exception:
        failures, imei = 0, False
    standing_pts = float(max(0, 20 - failures * 5))
    device_pts = 10.0 if imei else 0.0

    # ── Block state ──────────────────────────────────────────────────
    block = (await db.execute(
        select(CustomerBlock).where(CustomerBlock.customer_hash == user.customer_hash)
    )).scalar_one_or_none()
    is_blocked = bool(block and block.status == "blocked")

    score = enroll_pts + behav_pts + coercion_pts + standing_pts + device_pts
    if is_blocked:
        score = min(score, 10)   # blocked ⇒ cannot be trusted
    score = int(round(max(0, min(100, score))))

    provisional = total == 0
    if is_blocked or score < 45:
        band = "at_risk"
    elif score < 75:
        band = "watch"
    else:
        band = "secure"

    factors = [
        {"name": "Enrollment", "earned": enroll_pts, "max": 25,
         "detail": f"{enrolled}/{ALL_CHANNELS} channels enrolled"},
        {"name": "Behavioral consistency", "earned": behav_pts, "max": 30,
         "detail": (f"{anomalies}/{total} recent sessions flagged" if total else "no sessions yet")},
        {"name": "Coercion safety", "earned": coercion_pts, "max": 15,
         "detail": f"peak recent coercion {max_coercion:.2f}"},
        {"name": "Account standing", "earned": standing_pts, "max": 20,
         "detail": f"{failures} recent login failure(s)"},
        {"name": "Device integrity", "earned": device_pts, "max": 10,
         "detail": ("device baseline registered" if imei else "no device baseline")},
    ]
    return {
        "score": score,
        "band": band,
        "provisional": provisional,
        "is_blocked": is_blocked,
        "factors": factors,
        "sessions_considered": total,
    }
