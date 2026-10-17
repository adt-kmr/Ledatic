"""
Live-tunable risk thresholds for the FIU fraud-ops panel.

The decision engine (auth._decision_from_score + coercion check) reads its
thresholds through the sync getters here. Values come from a short-lived
in-process cache, refreshed from the `threshold_config` DB row. If the row is
absent or the DB is unreachable, the getters transparently fall back to the
static settings defaults — so tuning is a pure override layer and can never
break scoring.

Why a process-local cache (not a per-request DB read): _decision_from_score is
sync and on the hot path of every /evaluate. We refresh at most every
_THR_TTL seconds (called once near the top of the async handler), keeping
scoring allocation-free while still picking up admin edits within seconds.
"""
from __future__ import annotations

import logging
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.db_models import ThresholdConfig

logger = logging.getLogger(__name__)

# The singleton config row always uses id=1.
_CONFIG_ID = 1
_THR_TTL = 10.0  # seconds — how long a cached snapshot is trusted

_cache: dict = {"stepup": None, "block": None, "coercion": None, "loaded_at": 0.0}


# ── Sync getters used by the decision engine (fall back to settings) ────────
def stepup_threshold() -> int:
    v = _cache["stepup"]
    return v if v is not None else settings.ml_risk_threshold_approve


def block_threshold() -> int:
    v = _cache["block"]
    return v if v is not None else settings.ml_risk_threshold_block


def coercion_stepup_threshold() -> float:
    v = _cache["coercion"]
    return v if v is not None else settings.coercion_probability_stepup_threshold


def current_thresholds() -> dict:
    """Snapshot of the effective thresholds (for the admin GET + audit)."""
    return {
        "stepup_threshold": stepup_threshold(),
        "block_threshold": block_threshold(),
        "coercion_stepup_threshold": coercion_stepup_threshold(),
    }


# ── Refresh / write ─────────────────────────────────────────────────────────
def is_stale() -> bool:
    """True if the cache is older than the TTL — cheap sync check so callers only
    open a DB session when a refresh is actually due."""
    return (time.monotonic() - _cache["loaded_at"]) >= _THR_TTL


async def refresh(db: AsyncSession, force: bool = False) -> None:
    """Reload the cache from DB if the snapshot is stale (or forced). Non-fatal."""
    if not force and (time.monotonic() - _cache["loaded_at"]) < _THR_TTL:
        return
    try:
        row = (await db.execute(select(ThresholdConfig).limit(1))).scalar_one_or_none()
        if row is not None:
            _cache["stepup"] = row.stepup_threshold
            _cache["block"] = row.block_threshold
            _cache["coercion"] = row.coercion_stepup_threshold
        # else: leave cache as-is → getters fall back to settings defaults.
        _cache["loaded_at"] = time.monotonic()
    except Exception as exc:  # noqa: BLE001
        logger.warning("threshold refresh failed (%s) — keeping last-known/defaults", exc)


async def set_thresholds(
    db: AsyncSession,
    stepup: int,
    block: int,
    coercion: float,
    updated_by: str,
) -> dict:
    """Upsert the singleton config row and prime the cache. Returns the new state."""
    row = (await db.execute(select(ThresholdConfig).limit(1))).scalar_one_or_none()
    if row is None:
        row = ThresholdConfig(id=_CONFIG_ID)
        db.add(row)
    row.stepup_threshold = stepup
    row.block_threshold = block
    row.coercion_stepup_threshold = coercion
    row.updated_by = updated_by
    from sqlalchemy import func
    row.updated_at = func.now()
    await db.commit()
    # Prime the cache immediately so the very next scoring call sees the change.
    _cache["stepup"], _cache["block"], _cache["coercion"] = stepup, block, coercion
    _cache["loaded_at"] = time.monotonic()
    return current_thresholds()
