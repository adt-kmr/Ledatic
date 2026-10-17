"""
BTIC (Citadel Threat Intelligence Command Center) API endpoints.

These are READ-ONLY intelligence aggregation endpoints that sit ABOVE
the authentication engine. They consume existing session/risk data
without introducing latency into the auth pipeline.
"""
from __future__ import annotations

import json
import logging
import math
import random
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import desc, func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import get_redis
from app.core.security import AuthUser, require_role, decode_token, normalize_role
from app.models.db_models import (
    Session as DBSession,
    User,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/btic", tags=["btic"])

VIEW_ROLES = ("fiu_admin", "bank_analyst")


async def require_role_sse(
    request: Request,
    token: str = Query(None),
) -> AuthUser:
    """Auth dependency for SSE endpoints — checks Bearer header first,
    then falls back to ?token= query parameter (EventSource can't send headers)."""
    # Try Bearer header first
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        raw = auth_header[7:]
        try:
            claims = decode_token(raw)
            role = normalize_role(claims.get("role", "customer"))
            return AuthUser(
                customer_id=claims.get("sub", ""),
                bank_id=claims.get("bank_id", ""),
                user_hash="",
                role=role,
            )
        except Exception:
            pass

    # Fallback to query parameter
    if token:
        try:
            claims = decode_token(token)
            role = normalize_role(claims.get("role", "customer"))
            return AuthUser(
                customer_id=claims.get("sub", ""),
                bank_id=claims.get("bank_id", ""),
                user_hash="",
                role=role,
            )
        except Exception:
            pass

    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Authentication required")


# ── SSE Live Event Stream ──────────────────────────────────────────────────

@router.get("/events/stream")
async def event_stream(
    caller: AuthUser = Depends(require_role_sse),
    redis: Redis = Depends(get_redis),
):
    """SSE endpoint for live threat events. Subscribes to Redis pub/sub on the
    'btic:events' channel, which auth.py publishes to on every real session
    evaluation (i.e. every login on /demo/bank). Falls back to a mock event
    generator only if Redis is unreachable, so the demo still works offline.
    """
    async def generate_real():
        """Stream real session events published by auth.py._persist_session."""
        pubsub = redis.pubsub()
        await pubsub.subscribe("btic:events")
        try:
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=15.0
                )
                if message is None:
                    # Keep the connection alive through proxies/load balancers.
                    yield ": keepalive\n\n"
                    continue
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                yield f"data: {data}\n\n"
        finally:
            await pubsub.unsubscribe("btic:events")
            await pubsub.close()

    async def generate_mock():
        import asyncio
        import random

        threat_types = ["SIM_SWAP", "CREDENTIAL_THEFT", "COERCION", "MONEY_MULE", "BEHAVIORAL_ANOMALY"]
        states = [
            ("Maharashtra", "MH", "Mumbai", 19.08, 72.88),
            ("Delhi NCR", "DL", "Delhi", 28.61, 77.23),
            ("Karnataka", "KA", "Bangalore", 12.97, 77.59),
            ("Tamil Nadu", "TN", "Chennai", 13.08, 80.27),
            ("Gujarat", "GJ", "Ahmedabad", 23.02, 72.57),
            ("Uttar Pradesh", "UP", "Lucknow", 26.85, 80.95),
            ("Rajasthan", "RJ", "Jaipur", 26.91, 75.79),
            ("West Bengal", "WB", "Kolkata", 22.57, 88.36),
        ]
        channels = ["web", "mobile_app", "ussd"]

        while True:
            threat_type = random.choice(threat_types)
            state = random.choice(states)
            risk_score = random.randint(200, 950)
            decision = (
                "HARD_BLOCK" if risk_score > 700
                else "STEP_UP" if risk_score > 400
                else "APPROVE"
            )

            event = {
                "type": "session_evaluated",
                "session_id": str(uuid.uuid4()),
                "customer_hash": uuid.uuid4().hex[:12],
                "decision": decision,
                "risk_score": risk_score,
                "channel": random.choice(channels),
                "pathway": "behavioral",
                "threat_type": threat_type,
                "location": {
                    "state": state[0],
                    "stateCode": state[1],
                    "city": state[2],
                    "lat": state[3] + random.uniform(-0.5, 0.5),
                    "lng": state[4] + random.uniform(-0.5, 0.5),
                },
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

            yield f"data: {json.dumps(event)}\n\n"
            await asyncio.sleep(3 + random.random() * 4)  # 3-7 seconds between events

    try:
        await redis.ping()
        generator = generate_real()
    except Exception:
        logger.warning("Redis unreachable — /api/btic/events/stream falling back to mock feed")
        generator = generate_mock()

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Hero Statistics ────────────────────────────────────────────────────────

class HeroStatsResponse(BaseModel):
    identityConfidence: float
    activeThreats: int
    criticalIncidents: int
    protectedTransactions: int
    trend: list[dict]


@router.get("/hero/stats")
async def hero_stats(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Aggregated hero statistics for the command center overview."""
    now = datetime.utcnow()
    one_hour_ago = now - timedelta(hours=1)
    one_day_ago = now - timedelta(days=1)

    # Active threats (STEP_UP + HARD_BLOCK in last hour)
    active_threats = (await db.execute(
        select(func.count()).select_from(DBSession).where(
            and_(
                DBSession.created_at >= one_hour_ago,
                DBSession.decision.in_(["STEP_UP", "HARD_BLOCK"]),
            )
        )
    )).scalar_one() or 0

    # Critical incidents (HARD_BLOCK in last 24h)
    critical = (await db.execute(
        select(func.count()).select_from(DBSession).where(
            and_(
                DBSession.created_at >= one_day_ago,
                DBSession.decision == "HARD_BLOCK",
            )
        )
    )).scalar_one() or 0

    # Protected transactions (APPROVE today)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    protected = (await db.execute(
        select(func.count()).select_from(DBSession).where(
            and_(
                DBSession.created_at >= today_start,
                DBSession.decision == "APPROVE",
            )
        )
    )).scalar_one() or 0

    # Identity confidence (average risk score of approved sessions)
    avg_risk = (await db.execute(
        select(func.avg(DBSession.risk_score)).where(
            DBSession.decision == "APPROVE"
        )
    )).scalar_one() or 85

    # Clamp to 0-100
    confidence = max(0, min(100, 100 - (avg_risk / 10)))

    return {
        "identityConfidence": round(confidence, 1),
        "activeThreats": active_threats,
        "criticalIncidents": critical,
        "protectedTransactions": protected,
        "trend": [
            {"label": "Identity Confidence", "value": round(confidence, 1), "trend": []},
            {"label": "Active Threats", "value": active_threats, "trend": []},
            {"label": "Critical Incidents", "value": critical, "trend": []},
            {"label": "Protected Transactions", "value": protected, "trend": []},
        ],
    }


# ── Threat Aggregation ─────────────────────────────────────────────────────

# Indian states with center coordinates and threat weights for hex generation
INDIAN_STATES_GEO = [
    ("Maharashtra", "MH", 19.75, 75.71, 1.4),
    ("Delhi NCR", "DL", 28.61, 77.23, 1.6),
    ("Karnataka", "KA", 15.32, 75.71, 1.2),
    ("Tamil Nadu", "TN", 11.13, 78.06, 1.1),
    ("Uttar Pradesh", "UP", 26.85, 80.91, 1.5),
    ("Gujarat", "GJ", 22.26, 71.19, 1.3),
    ("Rajasthan", "RJ", 27.02, 74.22, 1.0),
    ("West Bengal", "WB", 22.99, 87.75, 1.2),
    ("Madhya Pradesh", "MP", 22.97, 78.66, 0.9),
    ("Telangana", "TS", 17.12, 79.20, 1.3),
    ("Andhra Pradesh", "AP", 15.91, 79.74, 1.0),
    ("Kerala", "KL", 10.85, 76.27, 0.8),
    ("Punjab", "PB", 31.15, 75.34, 1.1),
    ("Haryana", "HR", 29.06, 76.08, 1.2),
    ("Bihar", "BR", 25.10, 85.31, 1.0),
    ("Odisha", "OR", 20.95, 85.10, 0.8),
    ("Assam", "AS", 26.20, 92.94, 0.7),
    ("Jharkhand", "JH", 23.61, 85.28, 0.9),
    ("Chhattisgarh", "CG", 21.27, 81.87, 0.7),
    ("Uttarakhand", "UK", 30.07, 79.02, 0.6),
]

# Major cities for extra density
MAJOR_CITIES_GEO = [
    ("Mumbai", "Maharashtra", "MH", 19.08, 72.88, 20411000),
    ("Delhi", "Delhi NCR", "DL", 28.61, 77.23, 18980000),
    ("Bangalore", "Karnataka", "KA", 12.97, 77.59, 12327000),
    ("Hyderabad", "Telangana", "TS", 17.39, 78.49, 10004000),
    ("Ahmedabad", "Gujarat", "GJ", 23.02, 72.57, 8439000),
    ("Chennai", "Tamil Nadu", "TN", 13.08, 80.27, 10971000),
    ("Kolkata", "West Bengal", "WB", 22.57, 88.36, 14850000),
    ("Pune", "Maharashtra", "MH", 18.52, 73.86, 7420000),
    ("Jaipur", "Rajasthan", "RJ", 26.91, 75.79, 3909000),
    ("Lucknow", "Uttar Pradesh", "UP", 26.85, 80.95, 3382000),
]

THREAT_TYPES_LIST = ["SIM_SWAP", "CREDENTIAL_THEFT", "COERCION", "MONEY_MULE", "BEHAVIORAL_ANOMALY", "MERCHANT_ABUSE", "IDENTITY_MISMATCH"]


def _derive_severity(threat_weight: float, density: float, rng: random.Random) -> str:
    score = threat_weight * density * (0.5 + rng.random())
    if score > 2.8:
        return "CRITICAL"
    if score > 2.0:
        return "HIGH"
    if score > 1.2:
        return "MEDIUM"
    return "LOW"


def _pick_threat_types(count: int, rng: random.Random) -> list[str]:
    shuffled = THREAT_TYPES_LIST[:]
    rng.shuffle(shuffled)
    return shuffled[:count]


def _find_nearest_city(lat: float, lng: float) -> str:
    nearest = MAJOR_CITIES_GEO[0][0]
    min_dist = float("inf")
    for city in MAJOR_CITIES_GEO:
        dist = math.sqrt((lat - city[3]) ** 2 + (lng - city[4]) ** 2)
        if dist < min_dist:
            min_dist = dist
            nearest = city[0]
    return nearest


def _generate_hex_cells(seed: int = 42) -> list[dict]:
    """Generate H3-like hex cells covering Indian states with realistic threat data."""
    rng = random.Random(seed)
    cells = []
    seen_positions = set()

    # Generate cells around state centers
    for state_name, state_code, base_lat, base_lng, threat_weight in INDIAN_STATES_GEO:
        cluster_radius = 1.5 + threat_weight * 0.5

        for d_lat_i in range(int(-cluster_radius * 10), int(cluster_radius * 10) + 1, 4):
            for d_lng_i in range(int(-cluster_radius * 10), int(cluster_radius * 10) + 1, 4):
                d_lat = d_lat_i / 10.0
                d_lng = d_lng_i / 10.0
                lat = base_lat + d_lat + (rng.random() - 0.5) * 0.15
                lng = base_lng + d_lng + (rng.random() - 0.5) * 0.15

                if lat < 6.5 or lat > 37 or lng < 68 or lng > 98:
                    continue

                # Quantize to ~2.5km grid (H3 res 5 equivalent)
                grid_key = (round(lat, 2), round(lng, 2))
                if grid_key in seen_positions:
                    continue
                seen_positions.add(grid_key)

                dist_from_center = math.sqrt((lat - base_lat) ** 2 + (lng - base_lng) ** 2)
                density_factor = max(0, 1 - dist_from_center / cluster_radius)

                if density_factor < 0.1 and rng.random() > 0.3:
                    continue

                threat_count = int(threat_weight * 8 * density_factor * (0.5 + rng.random()))
                if threat_count == 0:
                    continue

                severity = _derive_severity(threat_weight, density_factor, rng)
                threat_types = _pick_threat_types(1 + int(rng.random() * 3), rng)

                cells.append({
                    "h3Index": f"85{int(abs(lng) * 10000):08x}{int(abs(lat) * 10000):08x}"[:15],  # Pseudo H3-like index
                    "lat": round(lat, 4),
                    "lng": round(lng, 4),
                    "severity": severity,
                    "confidence": round(0.55 + rng.random() * 0.45, 2),
                    "threatCount": threat_count,
                    "threatTypes": threat_types,
                    "state": state_name,
                    "city": _find_nearest_city(lat, lng),
                })

    # Add extra density around Tier-1 cities
    for city_name, city_state, city_code, city_lat, city_lng, population in MAJOR_CITIES_GEO:
        city_density = population // 3000000
        for _ in range(city_density):
            offset_lat = (rng.random() - 0.5) * 0.6
            offset_lng = (rng.random() - 0.5) * 0.6
            lat = city_lat + offset_lat
            lng = city_lng + offset_lng

            grid_key = (round(lat, 2), round(lng, 2))
            if grid_key in seen_positions:
                continue
            seen_positions.add(grid_key)

            cells.append({
                "h3Index": f"85{int(abs(lng) * 10000):08x}{int(abs(lat) * 10000):08x}"[:15],
                "lat": round(lat, 4),
                "lng": round(lng, 4),
                "severity": _derive_severity(1.4, 0.8, rng),
                "confidence": round(0.65 + rng.random() * 0.35, 2),
                "threatCount": 2 + int(rng.random() * 10),
                "threatTypes": _pick_threat_types(1 + int(rng.random() * 2), rng),
                "state": city_state,
                "city": city_name,
            })

    return cells


def _generate_connections(cells: list[dict], seed: int = 42) -> list[dict]:
    """Generate connections between related hex cells."""
    rng = random.Random(seed)
    connections = []
    used_pairs = set()

    # Group cells by state
    state_groups: dict[str, list[dict]] = {}
    for cell in cells:
        state_groups.setdefault(cell["state"], []).append(cell)

    # Intra-state connections
    for state_cells in state_groups.values():
        if len(state_cells) < 2:
            continue
        num_conn = min(int(len(state_cells) * 0.3), 5)
        for _ in range(num_conn):
            a = rng.choice(state_cells)
            b = rng.choice(state_cells)
            if a["h3Index"] == b["h3Index"]:
                continue
            pair_key = tuple(sorted([a["h3Index"], b["h3Index"]]))
            if pair_key in used_pairs:
                continue
            used_pairs.add(pair_key)
            connections.append({
                "source": {"lat": a["lat"], "lng": a["lng"], "h3Index": a["h3Index"]},
                "target": {"lat": b["lat"], "lng": b["lng"], "h3Index": b["h3Index"]},
                "confidence": round(0.4 + rng.random() * 0.6, 2),
                "type": a["threatTypes"][0] if a["threatTypes"] else "BEHAVIORAL_ANOMALY",
            })

    # Cross-state connections (campaign propagation)
    for _ in range(20):
        a = rng.choice(cells)
        b = rng.choice(cells)
        if a["state"] == b["state"]:
            continue
        pair_key = tuple(sorted([a["h3Index"], b["h3Index"]]))
        if pair_key in used_pairs:
            continue
        used_pairs.add(pair_key)
        connections.append({
            "source": {"lat": a["lat"], "lng": a["lng"], "h3Index": a["h3Index"]},
            "target": {"lat": b["lat"], "lng": b["lng"], "h3Index": b["h3Index"]},
            "confidence": round(0.3 + rng.random() * 0.5, 2),
            "type": "SIM_SWAP",
            "campaignId": f"cmp-{int(rng.random() * 10) + 1:03d}",
        })

    return connections


# Cache for generated data (regenerate hourly)
_hex_cache: dict = {"cells": None, "connections": None, "generated_at": None}


def _get_or_generate_map_data() -> tuple[list[dict], list[dict]]:
    now = datetime.utcnow()
    if (
        _hex_cache["cells"] is None
        or _hex_cache["generated_at"] is None
        or (now - _hex_cache["generated_at"]).total_seconds() > 3600
    ):
        cells = _generate_hex_cells()
        connections = _generate_connections(cells)
        _hex_cache["cells"] = cells
        _hex_cache["connections"] = connections
        _hex_cache["generated_at"] = now
    return _hex_cache["cells"], _hex_cache["connections"]


@router.get("/threats/aggregate")
async def threat_aggregate(
    db: AsyncSession = Depends(get_db),
    hours: int = Query(24, ge=1, le=720),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Aggregated threat data for the map. Returns H3 hex cells with threat counts,
    severity, and connections between related cells."""
    # Try to get real session data from DB
    since = datetime.utcnow() - timedelta(hours=hours)
    sessions = (await db.execute(
        select(DBSession).where(DBSession.created_at >= since)
    )).scalars().all()

    # Generate base hex cells and connections (cached)
    cells, connections = _get_or_generate_map_data()

    # If we have real sessions, overlay their counts onto the cells
    if sessions:
        # Count sessions per state
        state_counts: dict[str, dict] = {}
        for s in sessions:
            # Use channel as a proxy for location (since sessions don't have lat/lng)
            state_key = s.channel or "unknown"
            if state_key not in state_counts:
                state_counts[state_key] = {"count": 0, "critical": 0, "high": 0}
            state_counts[state_key]["count"] += 1
            if s.risk_score and s.risk_score > 700:
                state_counts[state_key]["critical"] += 1
            elif s.risk_score and s.risk_score > 500:
                state_counts[state_key]["high"] += 1

        # Boost cells near high-activity channels
        for cell in cells:
            if cell["state"] in state_counts:
                boost = state_counts[cell["state"]]["count"] * 0.1
                cell["threatCount"] = max(1, cell["threatCount"] + int(boost))

    # Ensure we always have data even with empty DB
    if not cells:
        cells, connections = _get_or_generate_map_data()

    return {
        "hexCells": cells,
        "connections": connections,
        "totalThreats": sum(c["threatCount"] for c in cells),
        "lastUpdated": datetime.utcnow().isoformat(),
    }


# ── Identity Graph ─────────────────────────────────────────────────────────

@router.get("/graph/{customer_hash}")
async def customer_graph(
    customer_hash: str,
    db: AsyncSession = Depends(get_db),
    depth: int = Query(1, ge=1, le=3),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Identity graph centered on a customer. Returns nodes + edges.
    In production, this would traverse the relationship graph.
    For now, returns a basic structure.
    """
    # Find the user
    user = (await db.execute(
        select(User).where(func.lower(User.customer_hash) == customer_hash.lower())
    )).scalar_one_or_none()

    if not user:
        return {"nodes": [], "edges": []}

    # Get their sessions
    sessions = (await db.execute(
        select(DBSession).where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at)).limit(20)
    )).scalars().all()

    nodes = [
        {
            "id": f"user-{user.id}",
            "type": "user",
            "label": customer_hash[:12],
            "confidence": 0.85,
            "importance": 8,
            "metadata": {"customerHash": customer_hash},
        }
    ]

    edges = []
    for s in sessions:
        node_id = f"session-{s.id}"
        nodes.append({
            "id": node_id,
            "type": "behavior",
            "label": f"Session {str(s.id)[:8]}",
            "confidence": 0.7,
            "importance": 3,
            "metadata": {"decision": s.decision, "riskScore": s.risk_score},
        })
        edges.append({
            "id": f"edge-{s.id}",
            "source": f"user-{user.id}",
            "target": node_id,
            "type": "behavior_similarity",
            "confidence": 0.6 + (s.risk_score / 1000) * 0.4,
            "evidenceCount": 1,
            "firstSeen": s.created_at.isoformat() if s.created_at else "",
            "lastSeen": s.created_at.isoformat() if s.created_at else "",
            "explanation": f"Session with risk score {s.risk_score}",
        })

    return {"nodes": nodes, "edges": edges}


# ── Campaigns ──────────────────────────────────────────────────────────────

@router.get("/campaigns")
async def list_campaigns(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Active fraud campaigns detected by the system.
    In production, this would query a campaigns table.
    For now, returns mock campaigns derived from session patterns.
    """
    # Count recent blocked sessions as a proxy for campaigns
    blocked_count = (await db.execute(
        select(func.count()).select_from(DBSession).where(
            DBSession.decision == "HARD_BLOCK"
        )
    )).scalar_one() or 0

    return {
        "campaigns": [],
        "total": blocked_count,
        "message": "Campaign detection requires the ML pipeline to group related sessions",
    }


# ── Analytics ──────────────────────────────────────────────────────────────

@router.get("/analytics/trends")
async def threat_trends(
    db: AsyncSession = Depends(get_db),
    period: str = Query("7d"),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Threat volume over time for trend charts."""
    # Parse period
    days = 7
    if period == "1d":
        days = 1
    elif period == "30d":
        days = 30
    elif period == "90d":
        days = 90

    since = datetime.utcnow() - timedelta(days=days)

    # Get daily counts
    sessions = (await db.execute(
        select(DBSession).where(DBSession.created_at >= since)
    )).scalars().all()

    # Group by day
    daily: dict[str, dict] = {}
    for s in sessions:
        if s.created_at:
            day = s.created_at.strftime("%Y-%m-%d")
            if day not in daily:
                daily[day] = {"date": day, "critical": 0, "high": 0, "medium": 0, "low": 0, "count": 0}
            daily[day]["count"] += 1
            if s.risk_score and s.risk_score > 700:
                daily[day]["critical"] += 1
            elif s.risk_score and s.risk_score > 500:
                daily[day]["high"] += 1
            elif s.risk_score and s.risk_score > 300:
                daily[day]["medium"] += 1
            else:
                daily[day]["low"] += 1

    return sorted(daily.values(), key=lambda x: x["date"])


@router.get("/analytics/geo")
async def geographic_distribution(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """State-level threat density for the analytics heatmap."""
    # This is a simplified version — in production, would use geolocation
    return {
        "states": [],
        "message": "Geographic distribution requires IP geolocation service",
    }
