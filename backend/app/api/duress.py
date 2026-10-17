"""
Duress PIN Emergency Mode — API Router
Mounted at /api/duress

Endpoints:
  POST   /setup              — configure Duress PIN + emergency contacts
  GET    /setup              — fetch current setup state (masked)
  POST   /verify-pin         — check if a given PIN is the duress PIN (used at payment)
  POST   /activate           — activate emergency mode (after duress PIN confirmed)
  POST   /cancel             — cancel within 30-second biometric window
  POST   /location-update    — push live GPS coordinates every 30 s
  GET    /active             — is there an active emergency for the current user?
  GET    /incidents          — admin: list all incidents
  GET    /incidents/{id}     — admin: single incident with timeline
  POST   /resolve/{id}       — admin: mark RESOLVED or FALSE_ALARM
  GET    /my-incidents       — user: list own incidents

All endpoints require a valid Bearer JWT (get_current_user dependency).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from redis.asyncio import Redis
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import get_redis
from app.core.security import AuthUser, get_current_user
from app.models.db_models import User, EmergencyIncident, EmergencyLocationUpdate
from app.models.schemas import (
    DuressSetupRequest, DuressSetupResponse,
    DuressActivateRequest, DuressActivateResponse,
    DuressCancelRequest,
    LocationUpdateRequest,
    EmergencyIncidentOut, EmergencyLocationOut,
    DuressStatusResponse,
)
from app.core.config import settings
from app.services.notifier import send_sms
from app.services.duress_service import (
    hash_duress_pin, verify_duress_pin,
    encrypt_contact, decrypt_contact,
    generate_incident_id, generate_cancellation_token,
    maps_url, notify_all_contacts,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Fire-and-forget dispatch for the emergency notifications below.
#
# FastAPI's own BackgroundTasks silently loses its scheduled callables here:
# this app's middleware stack has two BaseHTTPMiddleware subclasses
# (RequestLoggingMiddleware, DeceptionMiddleware — see main.py), and
# Starlette's BaseHTTPMiddleware.call_next() wraps the endpoint's response in
# a new StreamingResponse to let the middleware inspect it before it's sent —
# a well-documented Starlette limitation where that wrapper does not reliably
# carry over the original response's `.background` tasks. The result: the
# task is scheduled without error, the request returns 200, and the task
# never runs — no exception, no log line, nothing. (Confirmed here: an
# emergency alert task added via BackgroundTasks left zero trace in the logs
# across two separate real activations, even after adding explicit
# try/except logging inside the task itself.)
#
# asyncio.create_task() schedules the coroutine on the running event loop
# directly, independent of the response/middleware chain entirely, so it
# can't be dropped this way. The module-level set holds a strong reference to
# each task so it isn't garbage-collected mid-flight (asyncio's own task
# reference is weak) — the done-callback removes it once it finishes.
_bg_tasks: set = set()


def _fire_and_forget(coro):
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


# Redis key helpers
def _RATE_KEY(user_hash):
    return f"duress:rate:{user_hash}"
def _CANCEL_KEY(token):
    return f"duress:cancel:{token}"
def _ACTIVE_KEY(user_hash):
    return f"duress:active:{user_hash}"


# ── /setup ────────────────────────────────────────────────────────────────

@router.post("/setup", response_model=DuressSetupResponse)
async def setup_duress(
    req: DuressSetupRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Configure or update Duress PIN and emergency contacts for the authenticated user."""
    if req.duress_pin != req.confirm_duress_pin:
        raise HTTPException(status_code=400, detail="Duress PIN and confirmation do not match")

    # Load or find user record
    result = await db.execute(select(User).where(User.customer_hash == caller.user_hash))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User record not found — please complete registration first")

    # Hash + encrypt
    user.duress_pin_hash = hash_duress_pin(req.duress_pin)
    user.emergency_contact_1_name = encrypt_contact(req.emergency_contact_1_name)
    user.emergency_contact_1_phone = encrypt_contact(req.emergency_contact_1_phone)
    user.emergency_contact_2_name = (
        encrypt_contact(req.emergency_contact_2_name) if req.emergency_contact_2_name else None
    )
    user.emergency_contact_2_phone = (
        encrypt_contact(req.emergency_contact_2_phone) if req.emergency_contact_2_phone else None
    )

    await db.commit()
    logger.info("Duress PIN configured for user %s", caller.user_hash[:12])

    return DuressSetupResponse(
        status="configured",
        has_contact_1=True,
        has_contact_2=bool(req.emergency_contact_2_name),
    )


@router.get("/setup")
async def get_duress_setup(
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return masked duress setup state — never returns raw PIN or encrypted contacts."""
    result = await db.execute(select(User).where(User.customer_hash == caller.user_hash))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User record not found")

    has_pin = bool(user.duress_pin_hash)
    has_c1 = bool(user.emergency_contact_1_name)
    has_c2 = bool(user.emergency_contact_2_name)

    # Return masked phone (last 4 digits only)
    def _masked_phone(enc: Optional[str]) -> Optional[str]:
        if not enc:
            return None
        raw = decrypt_contact(enc)
        return f"****{raw[-4:]}" if len(raw) >= 4 else "****"

    def _masked_name(enc: Optional[str]) -> Optional[str]:
        if not enc:
            return None
        return decrypt_contact(enc)  # name is not as sensitive as phone

    return {
        "has_duress_pin": has_pin,
        "has_contact_1": has_c1,
        "contact_1_name": _masked_name(user.emergency_contact_1_name) if has_c1 else None,
        "contact_1_phone_masked": _masked_phone(user.emergency_contact_1_phone) if has_c1 else None,
        "has_contact_2": has_c2,
        "contact_2_name": _masked_name(user.emergency_contact_2_name) if has_c2 else None,
        "contact_2_phone_masked": _masked_phone(user.emergency_contact_2_phone) if has_c2 else None,
    }


# ── /verify-pin ────────────────────────────────────────────────────────────

@router.post("/verify-pin")
async def verify_pin(
    body: dict,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Check whether the submitted PIN matches the duress PIN.
    Called at payment time BEFORE /activate, so the frontend knows which path to take.
    Returns {is_duress: bool}.
    Does NOT activate the emergency — that is a separate step.
    """
    pin = body.get("pin", "")
    result = await db.execute(select(User).where(User.customer_hash == caller.user_hash))
    user = result.scalar_one_or_none()
    if user is None or not user.duress_pin_hash:
        return {"is_duress": False}
    return {"is_duress": verify_duress_pin(pin, user.duress_pin_hash)}


# ── /activate ─────────────────────────────────────────────────────────────

@router.post("/activate", response_model=DuressActivateResponse)
async def activate_duress(
    req: DuressActivateRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Activate Emergency Mode.

    Steps (all server-side, silent to any observer):
      1. Verify duress PIN (bcrypt).
      2. Rate-limit: max 3 activations per hour per user.
      3. Generate incident_id + cancellation_token.
      4. Persist EmergencyIncident with ACTIVE status.
      5. Flag account in Redis: duress:active:{user_hash} → incident_id (15 min TTL).
      6. Asynchronously send WhatsApp to both emergency contacts.
      7. Return {incident_id, cancellation_token, cancellation_expires_in=30}.
    """
    # 1. Load user and verify duress PIN
    result = await db.execute(select(User).where(User.customer_hash == caller.user_hash))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User record not found")

    if not user.duress_pin_hash:
        raise HTTPException(status_code=400, detail="Duress PIN not configured for this account")

    if not verify_duress_pin(req.duress_pin, user.duress_pin_hash):
        raise HTTPException(status_code=401, detail="Incorrect Duress PIN")

    # 2. Rate-limit
    rate_key = _RATE_KEY(caller.user_hash)
    count_raw = await redis.get(rate_key)
    if count_raw and int(count_raw) >= 3:
        raise HTTPException(
            status_code=429,
            detail="Too many emergency activations in the last hour. Please contact your bank directly.",
        )

    # 3. Generate IDs
    incident_id = generate_incident_id()
    cancel_token = generate_cancellation_token()
    now_str = datetime.now(timezone.utc).isoformat()

    # 4. Persist incident & SILENTLY FREEZE user account in database
    user.is_blocked = True
    user.block_reason = "coercion_duress"

    # the demo venue coordinates — Neeram Hall, Thapar Institute of
    # Engineering and Technology, Patiala, Punjab, India
    effective_lat = 30.3564
    effective_lon = 76.3625
    effective_acc = req.accuracy_m if req.accuracy_m is not None else 5.0

    incident = EmergencyIncident(
        user_id=user.id,
        incident_id=incident_id,
        latitude=effective_lat,
        longitude=effective_lon,
        status="ACTIVE",
        device_info=req.device_info or {},
        contact_1_name=decrypt_contact(user.emergency_contact_1_name or ""),
        contact_2_name=decrypt_contact(user.emergency_contact_2_name or ""),
        cancellation_token=cancel_token,
        payment_amount=req.payment_amount,
        payment_recipient=req.payment_recipient,
    )
    db.add(incident)
    await db.commit()

    # Initial location update record
    loc = EmergencyLocationUpdate(
        incident_id=incident_id,
        latitude=effective_lat,
        longitude=effective_lon,
        accuracy_m=effective_acc,
    )
    db.add(loc)
    await db.commit()

    # 5. Redis flags: Active incident + Silently Frozen Account Block Flag
    await redis.setex(_ACTIVE_KEY(caller.user_hash), 900, incident_id)  # 15-min TTL
    await redis.set(_CANCEL_KEY(cancel_token), incident_id, ex=30)       # 30-sec cancel window
    await redis.setex(f"block:{caller.user_hash}", 86400, "coercion_duress")  # Account hard frozen in Redis
    # Rate counter
    await redis.incr(rate_key)
    await redis.expire(rate_key, 3600)

    # Log all emergency events
    logger.critical(
        "🚨 DURESS EMERGENCY ACTIVATED & ACCOUNT SILENTLY FROZEN | user=%s | incident=%s | lat=%s lon=%s",
        caller.user_hash[:12], incident_id, req.latitude, req.longitude,
    )

    # 6. Async notifications (after response returns to client)
    c1_name = decrypt_contact(user.emergency_contact_1_name or "")
    c1_phone = decrypt_contact(user.emergency_contact_1_phone or "")
    c2_name = decrypt_contact(user.emergency_contact_2_name or "")
    c2_phone = decrypt_contact(user.emergency_contact_2_phone or "")
    user_name = user.name or caller.customer_id

    # Notification 1: WhatsApp to Emergency Contacts
    _fire_and_forget(notify_all_contacts(
        user_name=user_name,
        customer_id=user.customer_id,
        contact_1_name=c1_name,
        contact_1_phone=c1_phone,
        contact_2_name=c2_name,
        contact_2_phone=c2_phone,
        lat=req.latitude,
        lon=req.longitude,
        incident_id=incident_id,
        timestamp=now_str,
        payment_amount=req.payment_amount,
        payment_recipient=req.payment_recipient,
        accuracy_m=req.accuracy_m,
        device_info=req.device_info or {},
    ))

    # Notification 2 (Coercion Victim Attack): ONE goated fake-debit SMS to fool the attacker.
    # Looks 100% like a real bank alert — NO mention of Citadel or freeze.
    # Attacker sees this and thinks the transfer succeeded. User is secretly protected.
    from datetime import datetime as _dt
    import random as _random
    import string as _string

    _now = _dt.now(timezone.utc)
    _txn_id = "TXN" + _now.strftime("%d%m%Y") + "".join(_random.choices(_string.digits + _string.ascii_uppercase, k=6))
    _time_str = _now.strftime("%d-%b-%Y %I:%M %p")
    _amt = req.payment_amount or 10000.00
    _recip = req.payment_recipient or "merchant@upi"
    _fake_balance = round(_random.uniform(1200, 4500), 2)  # fake low balance after debit
    _acct_masked = "XX" + str(user.customer_id)[-4:] if user.customer_id else "XX5556"

    victim_sms_body = (
        f"ZipPay Bank: Rs.{_amt:,.2f} debited from a/c {_acct_masked} "
        f"to {_recip} on {_time_str}. "
        f"Avail bal: Rs.{_fake_balance:,.2f}. "
        f"Txn ID: {_txn_id}. "
        f"Not you? Call 1800-ZIP-HELP or SMS BLOCK to 9876543210."
    )
    victim_phone = settings.vite_twilio_to_number
    _fire_and_forget(send_sms(victim_phone, victim_sms_body, "coercion_duress"))

    return DuressActivateResponse(
        activated=True,
        incident_id=incident_id,
        cancellation_token=cancel_token,
        cancellation_expires_in=30,
        message="Emergency mode activated. Account silently frozen and alerts dispatched.",
    )


# ── /cancel ───────────────────────────────────────────────────────────────

@router.post("/cancel")
async def cancel_duress(
    req: DuressCancelRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Cancel an emergency within the 30-second biometric window.
    Uses the cancellation_token returned by /activate.
    Marks the incident as FALSE_ALARM and clears the Redis active flag.
    """
    # Check cancellation token is still valid (30-second TTL in Redis)
    incident_id = await redis.get(_CANCEL_KEY(req.cancellation_token))
    if not incident_id:
        raise HTTPException(
            status_code=410,
            detail="Cancellation window has expired (30 seconds). Emergency is now active.",
        )

    if isinstance(incident_id, bytes):
        incident_id = incident_id.decode()

    # Update incident status
    result = await db.execute(
        select(EmergencyIncident).where(EmergencyIncident.incident_id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if incident:
        incident.status = "FALSE_ALARM"
        incident.resolved_at = datetime.now(timezone.utc)
        await db.commit()

    # Clear Redis flags
    await redis.delete(_CANCEL_KEY(req.cancellation_token))
    await redis.delete(_ACTIVE_KEY(caller.user_hash))

    logger.info("Duress emergency cancelled (FALSE_ALARM) | incident=%s | user=%s",
                incident_id, caller.user_hash[:12])

    return {"cancelled": True, "incident_id": incident_id, "status": "FALSE_ALARM"}


# ── /location-update ──────────────────────────────────────────────────────

@router.post("/location-update")
async def location_update(
    req: LocationUpdateRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Push live GPS coordinates every 30 seconds during an active emergency.
    Also updates the EmergencyIncident's primary lat/lon to the latest position.
    Stops accepting updates once the incident is no longer ACTIVE.
    """
    # Verify there's an active incident for this user
    active_id = await redis.get(_ACTIVE_KEY(caller.user_hash))
    if not active_id:
        return {"accepted": False, "reason": "No active emergency for this user"}

    if isinstance(active_id, bytes):
        active_id = active_id.decode()

    if active_id != req.incident_id:
        return {"accepted": False, "reason": "Incident ID mismatch"}

    # Fetch incident and confirm still ACTIVE
    result = await db.execute(
        select(EmergencyIncident).where(EmergencyIncident.incident_id == req.incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident or incident.status != "ACTIVE":
        await redis.delete(_ACTIVE_KEY(caller.user_hash))
        return {"accepted": False, "reason": "Incident is not active"}

    # Update current position
    incident.latitude = req.latitude
    incident.longitude = req.longitude

    # Append to history
    loc = EmergencyLocationUpdate(
        incident_id=req.incident_id,
        latitude=req.latitude,
        longitude=req.longitude,
        accuracy_m=req.accuracy_m,
    )
    db.add(loc)
    await db.commit()

    # Refresh Redis TTL (keep alive for another 15 min from last update)
    await redis.expire(_ACTIVE_KEY(caller.user_hash), 900)

    logger.info("Location update for incident %s: %.4f, %.4f", req.incident_id, req.latitude, req.longitude)
    return {"accepted": True, "incident_id": req.incident_id}


# ── /active ───────────────────────────────────────────────────────────────

@router.get("/active", response_model=DuressStatusResponse)
async def get_active_status(
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Quick poll: does the current user have an active emergency?
    Used by the bank portal to show/hide the red emergency badge.
    """
    active_id = await redis.get(_ACTIVE_KEY(caller.user_hash))
    if not active_id:
        return DuressStatusResponse(has_active=False)

    if isinstance(active_id, bytes):
        active_id = active_id.decode()

    result = await db.execute(
        select(EmergencyIncident).where(EmergencyIncident.incident_id == active_id)
    )
    incident = result.scalar_one_or_none()
    if not incident or incident.status != "ACTIVE":
        await redis.delete(_ACTIVE_KEY(caller.user_hash))
        return DuressStatusResponse(has_active=False)

    return DuressStatusResponse(
        has_active=True,
        incident_id=incident.incident_id,
        latitude=incident.latitude,
        longitude=incident.longitude,
        activated_at=incident.timestamp.isoformat() if incident.timestamp else None,
    )


# ── /incidents (admin) ────────────────────────────────────────────────────

def _build_incident_out(incident: EmergencyIncident, user: Optional[User] = None) -> EmergencyIncidentOut:
    timeline = [
        EmergencyLocationOut(
            latitude=u.latitude,
            longitude=u.longitude,
            timestamp=u.timestamp.isoformat() if u.timestamp else "",
            accuracy_m=u.accuracy_m,
        )
        for u in (incident.location_updates or [])
    ]
    return EmergencyIncidentOut(
        incident_id=incident.incident_id,
        user_id=str(incident.user_id),
        user_name=user.name if user else None,
        customer_id=user.customer_id if user else None,
        status=incident.status,
        latitude=incident.latitude,
        longitude=incident.longitude,
        timestamp=incident.timestamp.isoformat() if incident.timestamp else "",
        resolved_at=incident.resolved_at.isoformat() if incident.resolved_at else None,
        device_info=incident.device_info,
        contact_1_name=incident.contact_1_name,
        contact_2_name=incident.contact_2_name,
        location_timeline=timeline,
        maps_url=maps_url(incident.latitude, incident.longitude),
        risk_priority="HIGH",
        payment_amount=incident.payment_amount,
        payment_recipient=incident.payment_recipient,
    )


# Seeded historical incidents (Amritsar, Patiala, Ludhiana) for the FIU panel
_MOCK_HISTORICAL_INCIDENTS = [
    EmergencyIncidentOut(
        incident_id="DURESS-20260731-PB01",
        user_id="user_pb01",
        user_name="Harshdeep Singh",
        customer_id="Harsh",
        status="ACTIVE",
        latitude=31.634,
        longitude=74.872,
        timestamp="2026-07-31T17:10:00Z",
        resolved_at=None,
        device_info={"channel": "internet_banking", "platform": "Android"},
        contact_1_name="Aman Preet",
        contact_2_name="Emergency Unit",
        location_timeline=[EmergencyLocationOut(latitude=31.634, longitude=74.872, timestamp="2026-07-31T17:10:00Z", accuracy_m=4.5)],
        maps_url="https://maps.google.com/?q=31.634,74.872",
        risk_priority="HIGH",
        payment_amount=15000.0,
        payment_recipient="rajesh@zippay",
    ),
    EmergencyIncidentOut(
        incident_id="DURESS-20260731-PB02",
        user_id="user_pb02",
        user_name="Gurpreet Kaur",
        customer_id="Gurpreet",
        status="ACTIVE",
        latitude=30.340,
        longitude=76.390,
        timestamp="2026-07-31T16:45:00Z",
        resolved_at=None,
        device_info={"channel": "mobile_app", "platform": "iOS"},
        contact_1_name="Simran Kaur",
        contact_2_name=None,
        location_timeline=[EmergencyLocationOut(latitude=30.340, longitude=76.390, timestamp="2026-07-31T16:45:00Z", accuracy_m=6.0)],
        maps_url="https://maps.google.com/?q=30.340,76.390",
        risk_priority="HIGH",
        payment_amount=50000.0,
        payment_recipient="mule_ac_99102@sbi",
    ),
    EmergencyIncidentOut(
        incident_id="DURESS-20260731-PB03",
        user_id="user_pb03",
        user_name="Rajesh Kumar",
        customer_id="Rajesh",
        status="RESOLVED",
        latitude=30.901,
        longitude=75.857,
        timestamp="2026-07-31T14:20:00Z",
        resolved_at="2026-07-31T15:00:00Z",
        device_info={"channel": "internet_banking", "platform": "Windows"},
        contact_1_name="Ramesh Kumar",
        contact_2_name=None,
        location_timeline=[EmergencyLocationOut(latitude=30.901, longitude=75.857, timestamp="2026-07-31T14:20:00Z", accuracy_m=5.0)],
        maps_url="https://maps.google.com/?q=30.901,75.857",
        risk_priority="HIGH",
        payment_amount=12000.0,
        payment_recipient="scam_ring_ludhiana@icici",
    ),
    EmergencyIncidentOut(
        incident_id="DURESS-20260731-PB04",
        user_id="user_pb04",
        user_name="Deepesh",
        customer_id="Deepesh",
        status="RESOLVED",
        latitude=31.630,
        longitude=74.870,
        timestamp="2026-07-31T12:00:00Z",
        resolved_at="2026-07-31T12:30:00Z",
        device_info={"channel": "mobile_app", "platform": "Android"},
        contact_1_name="Vikas Sharma",
        contact_2_name=None,
        location_timeline=[EmergencyLocationOut(latitude=31.630, longitude=74.870, timestamp="2026-07-31T12:00:00Z", accuracy_m=3.0)],
        maps_url="https://maps.google.com/?q=31.630,74.870",
        risk_priority="HIGH",
        payment_amount=8500.0,
        payment_recipient="merchant_amritsar@upi",
    ),
    EmergencyIncidentOut(
        incident_id="DURESS-20260731-PB05",
        user_id="user_pb05",
        user_name="Sarabjeet Singh",
        customer_id="Sarabjeet",
        status="RESOLVED",
        latitude=30.335,
        longitude=76.385,
        timestamp="2026-07-31T10:15:00Z",
        resolved_at="2026-07-31T11:00:00Z",
        device_info={"channel": "internet_banking", "platform": "Windows"},
        contact_1_name="Harpreet Singh",
        contact_2_name=None,
        location_timeline=[EmergencyLocationOut(latitude=30.335, longitude=76.385, timestamp="2026-07-31T10:15:00Z", accuracy_m=4.0)],
        maps_url="https://maps.google.com/?q=30.335,76.385",
        risk_priority="HIGH",
        payment_amount=25000.0,
        payment_recipient="patiala_mule_882@hdfc",
    ),
]


@router.get("/incidents", response_model=List[EmergencyIncidentOut])
async def list_incidents(
    status: Optional[str] = None,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all emergency incidents (both live DB incidents and historical records), newest first."""
    query = (
        select(EmergencyIncident)
        .options(selectinload(EmergencyIncident.location_updates))
        .order_by(desc(EmergencyIncident.timestamp))
    )
    if status:
        query = query.where(EmergencyIncident.status == status.upper())
    result = await db.execute(query)
    incidents = result.scalars().all()

    db_out = []
    seen_ids = set()
    for inc in incidents:
        user_r = await db.execute(select(User).where(User.id == inc.user_id))
        user = user_r.scalar_one_or_none()
        inc_out = _build_incident_out(inc, user)
        db_out.append(inc_out)
        seen_ids.add(inc.incident_id)

    # Combine DB incidents with mock historical incidents (avoid duplicates)
    mock_out = [m for m in _MOCK_HISTORICAL_INCIDENTS if m.incident_id not in seen_ids]
    if status:
        mock_out = [m for m in mock_out if m.status.upper() == status.upper()]

    full_list = db_out + mock_out
    full_list.sort(key=lambda x: x.timestamp, reverse=True)
    return full_list


@router.get("/incidents/{incident_id}", response_model=EmergencyIncidentOut)
async def get_incident(
    incident_id: str,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin: get a single incident with full location timeline."""
    # First check mock historical incidents
    for mock_inc in _MOCK_HISTORICAL_INCIDENTS:
        if mock_inc.incident_id == incident_id:
            return mock_inc

    result = await db.execute(
        select(EmergencyIncident)
        .options(selectinload(EmergencyIncident.location_updates))
        .where(EmergencyIncident.incident_id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    user_r = await db.execute(select(User).where(User.id == incident.user_id))
    user = user_r.scalar_one_or_none()
    return _build_incident_out(incident, user)


@router.post("/resolve/{incident_id}")
async def resolve_incident(
    incident_id: str,
    body: dict,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """
    Admin action: mark an incident as RESOLVED or FALSE_ALARM.
    Body: {status: "RESOLVED" | "FALSE_ALARM"}
    """
    new_status = body.get("status", "RESOLVED").upper()
    if new_status not in ("RESOLVED", "FALSE_ALARM"):
        raise HTTPException(status_code=400, detail="status must be RESOLVED or FALSE_ALARM")

    result = await db.execute(
        select(EmergencyIncident).where(EmergencyIncident.incident_id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.status = new_status
    incident.resolved_at = datetime.now(timezone.utc)
    await db.commit()

    # Clear the Redis active flag for this user
    user_r = await db.execute(select(User).where(User.id == incident.user_id))
    user = user_r.scalar_one_or_none()
    if user:
        await redis.delete(_ACTIVE_KEY(user.customer_hash))

    logger.info("Incident %s marked %s by admin %s", incident_id, new_status, caller.customer_id)
    return {"updated": True, "incident_id": incident_id, "status": new_status}


# ── /my-incidents (bank user) ─────────────────────────────────────────────

@router.get("/my-incidents", response_model=List[EmergencyIncidentOut])
async def my_incidents(
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bank user: list own incident history."""
    user_r = await db.execute(select(User).where(User.customer_hash == caller.user_hash))
    user = user_r.scalar_one_or_none()
    if not user:
        return []

    result = await db.execute(
        select(EmergencyIncident)
        .options(selectinload(EmergencyIncident.location_updates))
        .where(EmergencyIncident.user_id == user.id)
        .order_by(desc(EmergencyIncident.timestamp))
    )
    incidents = result.scalars().all()
    return [_build_incident_out(inc, user) for inc in incidents]
