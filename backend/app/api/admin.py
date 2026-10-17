"""
FIU fraud-ops admin panel API.

Every route here is gated by require_role(...) — the server-side authorization
boundary. The frontend /admin route guard is only UX; this is what actually
keeps a customer token out. Admin tokens are short-lived (jwt_admin_expire_minutes).
"""
from __future__ import annotations

import logging
import uuid

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, repair_schema
from app.core.ratelimit import rate_limit
from app.services.threat_level import classify as classify_threat
from app.core.redis_client import get_redis
from app.core.security import (
    AuthUser,
    create_access_token,
    derive_user_hash,
    require_role,
    verify_admin_credentials,
)
from app.models.db_models import (
    AdminAuditLog,
    BehavioralPassport,
    CustomerBlock,
    CustomerContact,
    FraudReport,
    Notification,
    RiskEvent,
    Session as DBSession,
    User,
)
from app.services import thresholds
from app.services import blocks as block_service
from app.services import notifier
from app.services import trust_score as trust_service
from app.services import forensics as forensics_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Roles allowed to view the panel at all (read surfaces). Write actions
# (e.g. threshold changes) additionally require "admin" — enforced per-route.
# Both roles may VIEW the panel + issue soft WARNINGs. Only fiu_admin (FIU
# department) may BLOCK/UNBLOCK and change thresholds — enforced per-route.
VIEW_ROLES = ("fiu_admin", "bank_analyst")
WRITE_ROLE = "fiu_admin"


async def _find_user(db: AsyncSession, customer_hash: str):
    """Case-insensitive customer lookup so 'harsh' matches 'Harsh'."""
    from sqlalchemy import func
    return (await db.execute(
        select(User).where(func.lower(User.customer_hash) == customer_hash.lower())
    )).scalar_one_or_none()


class AdminLoginRequest(BaseModel):
    admin_id: str
    password: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str
    bank_id: str
    expires_in_minutes: int


@router.post("/login", response_model=AdminLoginResponse,
             dependencies=[Depends(rate_limit(5, 60, "admin-login"))])
async def admin_login(req: AdminLoginRequest):
    """Authenticate an admin/analyst and issue a short-lived, role-scoped JWT."""
    acct = verify_admin_credentials(req.admin_id, req.password)
    if not acct:
        # Same generic message + status whether the id is unknown or the
        # password is wrong — no account enumeration.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
        )
    # Canonicalize to the stored id (verify_admin_credentials matches
    # case-insensitively) so JWT sub / audit logs always show "ADMIN", not
    # whatever case was typed.
    req.admin_id = acct["id"]
    token = create_access_token(
        customer_id=req.admin_id,
        bank_id=acct["bank_id"],
        role=acct["role"],
        expire_minutes=settings.jwt_admin_expire_minutes,
    )
    logger.info("Admin login: id=%s role=%s bank=%s", req.admin_id, acct["role"], acct["bank_id"])
    return AdminLoginResponse(
        access_token=token,
        role=acct["role"],
        name=acct["name"],
        bank_id=acct["bank_id"],
        expires_in_minutes=settings.jwt_admin_expire_minutes,
    )


@router.get("/me")
async def admin_me(caller: AuthUser = Depends(require_role(*VIEW_ROLES))):
    """Return the authenticated admin/analyst identity — used by the frontend guard."""
    return {"admin_id": caller.customer_id, "role": caller.role, "bank_id": caller.bank_id}


@router.post("/schema-repair")
async def admin_schema_repair(caller: AuthUser = Depends(require_role(WRITE_ROLE))):
    """Re-run the schema bootstrap against the live database.

    The same repair runs automatically at startup, but a deployment whose
    startup repair failed would otherwise stay broken until someone triggered a
    redeploy. This makes the fix reachable, and — unlike the startup path —
    returns exactly which statement failed and why instead of a bare 500.
    """
    report = await repair_schema()
    logger.info("schema repair triggered by %s: %s", caller.customer_id, report)
    return {
        "repaired": len(report.get("ok", [])),
        "failed": report.get("failed", []),
        "dialect": report.get("dialect"),
    }


# ── Live-tunable risk thresholds ────────────────────────────────────────────
class ThresholdConfigOut(BaseModel):
    stepup_threshold: int
    block_threshold: int
    coercion_stepup_threshold: float


class ThresholdUpdate(BaseModel):
    # Risk score is on a 0–1000 scale; coercion probability is 0–1.
    stepup_threshold: int = Field(..., ge=0, le=1000)
    block_threshold: int = Field(..., ge=0, le=1000)
    coercion_stepup_threshold: float = Field(..., ge=0.0, le=1.0)


@router.get("/config/thresholds", response_model=ThresholdConfigOut)
async def get_thresholds(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Current effective thresholds (analyst + admin may view)."""
    await thresholds.refresh(db, force=True)
    return thresholds.current_thresholds()


@router.put("/config/thresholds", response_model=ThresholdConfigOut)
async def update_thresholds(
    body: ThresholdUpdate,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(WRITE_ROLE)),  # write = admin only
):
    """Update thresholds live (admin only). Validated, applied immediately, audited."""
    if body.stepup_threshold >= body.block_threshold:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="stepup_threshold must be strictly less than block_threshold",
        )
    before = thresholds.current_thresholds()
    after = await thresholds.set_thresholds(
        db,
        stepup=body.stepup_threshold,
        block=body.block_threshold,
        coercion=body.coercion_stepup_threshold,
        updated_by=caller.customer_id,
    )
    # Audit trail — append-only record of who changed what.
    db.add(AdminAuditLog(
        actor=caller.customer_id,
        action="update_thresholds",
        target="threshold_config",
        before=before,
        after=after,
    ))
    await db.commit()
    logger.info("Thresholds updated by %s: %s -> %s", caller.customer_id, before, after)
    return after


# ── Read surfaces (analyst + admin) ─────────────────────────────────────────
async def _ml_health() -> dict:
    """Best-effort ML service health for the ops overview. Never fatal."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ml_service_url}/health")
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return {"status": "unreachable", "ml_ready": False, "txn_fraud_ready": False}


@router.get("/overview")
async def overview(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Live ops snapshot: active sessions, decision funnel, totals, model health."""
    # Decision funnel (all-time) — one grouped query.
    funnel_rows = (await db.execute(
        select(DBSession.decision, func.count()).group_by(DBSession.decision)
    )).all()
    funnel = {d or "UNKNOWN": n for d, n in funnel_rows}

    total_sessions = (await db.execute(select(func.count()).select_from(DBSession))).scalar_one()
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar_one()

    # Active sessions = live signal buffers currently in Redis (TTL-bounded).
    try:
        active_sessions = 0
        async for _ in redis.scan_iter(match="session:*:signals", count=200):
            active_sessions += 1
    except Exception:
        active_sessions = None  # redis unavailable

    return {
        "active_sessions": active_sessions,
        "totals": {"sessions": total_sessions, "users": total_users},
        "decision_funnel": {
            "APPROVE": funnel.get("APPROVE", 0),
            "STEP_UP": funnel.get("STEP_UP", 0),
            "HARD_BLOCK": funnel.get("HARD_BLOCK", 0),
        },
        "thresholds": thresholds.current_thresholds(),
        "model_health": await _ml_health(),
    }


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
    decision: Optional[str] = Query(None, description="APPROVE|STEP_UP|HARD_BLOCK"),
    channel: Optional[str] = None,
    min_risk: Optional[int] = Query(None, ge=0, le=1000),
    max_risk: Optional[int] = Query(None, ge=0, le=1000),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Cross-user session feed with filters (the analyst worklist)."""
    stmt = (
        select(DBSession, User.customer_hash)
        .join(User, DBSession.user_id == User.id)
        .order_by(desc(DBSession.created_at))
    )
    if decision:
        stmt = stmt.where(DBSession.decision == decision)
    if channel:
        stmt = stmt.where(DBSession.channel == channel)
    if min_risk is not None:
        stmt = stmt.where(DBSession.risk_score >= min_risk)
    if max_risk is not None:
        stmt = stmt.where(DBSession.risk_score <= max_risk)

    rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
    return {
        "count": len(rows),
        "limit": limit,
        "offset": offset,
        "sessions": [
            {
                "session_id": str(s.id),
                "customer_hash": ch,
                "channel": s.channel,
                "decision": s.decision,
                "pathway": s.pathway,
                "risk_score": s.risk_score,
                "coercion_probability": s.coercion_probability,
                "latency_ms": s.latency_ms,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, ch in rows
        ],
    }


@router.get("/sessions/{session_id}/forensics")
async def session_forensics(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Explainable 'why' for one session: SHAP + behaviour vs the customer's own baseline."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session id")
    session = (await db.execute(select(DBSession).where(DBSession.id == sid))).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    bundle = session.signal_bundle_json or {}
    feats = forensics_service.compute_features(bundle)

    # SHAP attributions from the persisted risk event (real model output).
    re = (await db.execute(
        select(RiskEvent).where(RiskEvent.session_id == sid)
        .order_by(desc(RiskEvent.timestamp)).limit(1)
    )).scalar_one_or_none()
    shap = (re.shap_explanation or {}).get("features") if re and re.shap_explanation else None

    # Baseline = the customer's OWN past APPROVED sessions (their normal).
    past = (await db.execute(
        select(DBSession.signal_bundle_json).where(
            DBSession.user_id == session.user_id,
            DBSession.decision == "APPROVE",
            DBSession.id != sid,
        ).order_by(desc(DBSession.created_at)).limit(30)
    )).scalars().all()
    baseline = forensics_service.baseline_from([b for b in past if b])

    return {
        "session_id": session_id,
        "decision": session.decision,
        "risk_score": session.risk_score,
        "pathway": session.pathway,
        "channel": session.channel,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "has_signals": feats["keystrokes"] > 0,
        "shap": shap,
        "features": feats,
        "baseline": baseline,
        "diff": forensics_service.diff(feats, baseline),
        "timeline": forensics_service.timeline(bundle),
    }


@router.get("/customers/{customer_hash}/trust")
async def customer_trust(
    customer_hash: str,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Transparent 0–100 trust/security score for one customer, from real signals only."""
    user = await _find_user(db, customer_hash)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return await trust_service.compute_trust(db, redis, user)


@router.get("/customers/{customer_hash}")
async def customer_360(
    customer_hash: str,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Everything the panel knows about one customer: passport, sessions, risk timeline."""
    user = await _find_user(db, customer_hash)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    passports = (await db.execute(
        select(BehavioralPassport).where(BehavioralPassport.user_id == user.id)
    )).scalars().all()

    sessions = (await db.execute(
        select(DBSession).where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at)).limit(25)
    )).scalars().all()

    # Progressive-hardening failure counter + IMEI baseline live in Redis keyed
    # by the derived HMAC user_hash (NOT the plaintext customer_hash the panel
    # addresses customers by). Derive it the same way auth.py does, or these
    # always read as 0/false. Blocks, by contrast, are keyed on customer_hash.
    user_hash = derive_user_hash(user.bank_id, user.customer_hash)
    try:
        raw = await redis.get(f"login_failures:{user_hash}")
        failures = int(raw) if raw else 0
        imei_enrolled = bool(await redis.exists(f"imei_baseline:{user_hash}"))
    except Exception:
        failures, imei_enrolled = None, None

    # Use the canonical customer_hash from the matched user (not the raw, possibly
    # differently-cased search term) so block/contact records resolve correctly.
    chash = user.customer_hash
    block_row = (await db.execute(
        select(CustomerBlock).where(CustomerBlock.customer_hash == chash)
    )).scalar_one_or_none()
    contact_row = (await db.execute(
        select(CustomerContact).where(CustomerContact.customer_hash == chash)
    )).scalar_one_or_none()

    return {
        "customer_hash": chash,
        "bank_id": user.bank_id,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "login_failures": failures,
        "imei_baseline_enrolled": imei_enrolled,
        "block": {
            "status": block_row.status if block_row else "unblocked",
            "reason": block_row.reason if block_row else None,
            "message": block_row.message if block_row else None,
            "actor": block_row.actor if block_row else None,
            "updated_at": block_row.updated_at.isoformat() if block_row and block_row.updated_at else None,
        },
        "contact": {
            "email": contact_row.email if contact_row else None,
            "phone": contact_row.phone if contact_row else None,
        },
        "channels": [
            {
                "channel": p.channel,
                "is_enrolled": p.is_enrolled,
                "enrollment_shots": p.enrollment_shots,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in passports
        ],
        "recent_sessions": [
            {
                "session_id": str(s.id),
                "channel": s.channel,
                "decision": s.decision,
                "risk_score": s.risk_score,
                "pathway": s.pathway,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in sessions
        ],
    }


# ── Block / unblock / notify (admin write actions) ──────────────────────────
# These turn the panel from a dashboard into a console: an analyst can lock a
# customer account, and the customer is told exactly what to do next. Every
# action is admin-only (analysts read but cannot act) and appended to the audit
# log. Block state lives in the customer_block table (source of truth) + a Redis
# mirror that /evaluate checks before any other pathway.
class ContactUpdate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None


@router.get("/notify/preview")
async def notify_preview(
    reason: str = Query("manual"),
    channel: str = Query("email", pattern="^(email|sms)$"),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Render a message template for the modal's live preview — authoritative, so
    the preview the analyst sees is byte-for-byte what will be sent. Analyst + admin."""
    rendered = notifier.render(reason, channel, customer_label="Customer")
    return {"reason": reason, "channel": channel, **rendered}


class NotifyRequest(BaseModel):
    email: bool = False
    sms: bool = False
    # Optional one-off override so the analyst can send to a contact they just
    # looked up without first saving it to the contact store.
    contact_override: Optional[ContactUpdate] = None
    # Optional free-text analyst note appended to the template body.
    note: Optional[str] = None


class BlockRequest(NotifyRequest):
    reason: str  # sim_swap | coercion | behavioral_anomaly | manual
    message: Optional[str] = None  # analyst-visible note stored on the block row


class UnblockRequest(NotifyRequest):
    reason: Optional[str] = "manual"  # why the block is being lifted


@router.get("/customers/{customer_hash}/block")
async def get_block_status(
    customer_hash: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Current block status + last actor/reason for the Customer 360 banner."""
    row = (await db.execute(
        select(CustomerBlock).where(CustomerBlock.customer_hash == customer_hash)
    )).scalar_one_or_none()
    contact = (await db.execute(
        select(CustomerContact).where(CustomerContact.customer_hash == customer_hash)
    )).scalar_one_or_none()
    return {
        "status": row.status if row else "unblocked",
        "reason": row.reason if row else None,
        "message": row.message if row else None,
        "actor": row.actor if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        "reason_options": notifier.REASON_OPTIONS,
        "contact": {
            "email": contact.email if contact else None,
            "phone": contact.phone if contact else None,
        } if contact else {"email": None, "phone": None},
    }


@router.put("/customers/{customer_hash}/contact")
async def upsert_contact(
    customer_hash: str,
    body: ContactUpdate,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(WRITE_ROLE)),
):
    """Save/edit the customer's email + phone (used by the notify flow). Admin only."""
    row = (await db.execute(
        select(CustomerContact).where(CustomerContact.customer_hash == customer_hash)
    )).scalar_one_or_none()
    before = {"email": row.email, "phone": row.phone} if row else None
    if row is None:
        row = CustomerContact(customer_hash=customer_hash)
        db.add(row)
    row.email = body.email or row.email
    row.phone = body.phone or row.phone
    row.updated_by = caller.customer_id
    await db.commit()
    after = {"email": row.email, "phone": row.phone}
    db.add(AdminAuditLog(
        actor=caller.customer_id,
        action="update_contact",
        target=customer_hash,
        before=before,
        after=after,
    ))
    await db.commit()
    return {"email": row.email, "phone": row.phone}


async def _dispatch_notifications(
    db: AsyncSession,
    redis: Redis,
    customer_hash: str,
    reason: str,
    notify: NotifyRequest,
    actor: str,
) -> list[dict]:
    """Render + send the requested channels, persist a Notification row per channel.

    Returns one summary dict per channel for the API response. Faithful: the
    recorded status reflects the path that actually ran (sent/simulated/failed).
    """
    contact = (await db.execute(
        select(CustomerContact).where(CustomerContact.customer_hash == customer_hash)
    )).scalar_one_or_none()
    email_to = (notify.contact_override.email if notify.contact_override else None) or (contact.email if contact else None)
    phone_to = (notify.contact_override.phone if notify.contact_override else None) or (contact.phone if contact else None)

    results: list[dict] = []
    if notify.email:
        rendered = notifier.render(reason, "email", customer_label=customer_hash[:8])
        if notify.note:
            rendered["body"] += f"\n\nNote from analyst: {notify.note}"
        out = await notifier.send_email(email_to or "", rendered["subject"], rendered["body"], reason)
        db.add(Notification(
            customer_hash=customer_hash, channel="email", to_address=email_to,
            subject=rendered["subject"], body=out["body"], reason=reason,
            status=out["status"], provider=out["provider"], actor=actor,
        ))
        results.append({"channel": "email", "to": email_to, **out})
    if notify.sms:
        rendered = notifier.render(reason, "sms", customer_label=customer_hash[:8])
        if notify.note:
            rendered["body"] += f" Note: {notify.note}"
        out = await notifier.send_sms(phone_to or "", rendered["body"], reason)
        db.add(Notification(
            customer_hash=customer_hash, channel="sms", to_address=phone_to,
            subject="", body=out["body"], reason=reason,
            status=out["status"], provider=out["provider"], actor=actor,
        ))
        results.append({"channel": "sms", "to": phone_to, **out})
    return results


@router.post("/customers/{customer_hash}/warn")
async def warn_customer(
    customer_hash: str,
    body: NotifyRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),  # both roles may warn
):
    """Send a soft security WARNING (email/SMS) without blocking the account.

    Models the escalation chain: FIU fraud-ops raises the alert in the panel, it
    is relayed to the customer as if from their bank. No account-state change;
    fully audited and surfaced on the Fraud Intelligence dashboard.
    """
    user = await _find_user(db, customer_hash)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    chash = user.customer_hash
    notifications = await _dispatch_notifications(db, redis, chash, "warning", body, caller.customer_id)
    db.add(AdminAuditLog(
        actor=caller.customer_id, action="warn_customer", target=chash,
        before=None, after={"channels": [n["channel"] for n in notifications]},
    ))
    latest_sid = (await db.execute(
        select(DBSession.id).where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at)).limit(1)
    )).scalar_one_or_none()
    if latest_sid is not None:
        db.add(FraudReport(
            session_id=latest_sid,
            report_text=f"Security warning sent to {chash} by {caller.customer_id} (FIU→bank→customer) — precautionary alert, account not blocked",
            risk_score=0,
            trigger_signals={"threat_level": classify_threat(0), "evidence": ["precautionary warning"], "warning": True},
            analyst_action="Customer warned",
        ))
    await db.commit()
    logger.info("Customer %s warned by %s (channels=%s)", chash[:12], caller.customer_id, [n["channel"] for n in notifications])
    return {"warned": True, "customer_hash": chash, "notifications": notifications}


@router.post("/customers/{customer_hash}/block")
async def block_customer(
    customer_hash: str,
    body: BlockRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(WRITE_ROLE)),  # write = admin only
):
    """Block a customer account (admin only). Mirrors to Redis so the very next
    /evaluate returns HARD_BLOCK (pathway=ADMIN_BLOCK), and optionally emails +
    SMSes the customer with concrete next-steps. Fully audited."""
    # Ensure the customer exists (so a typo doesn't create an orphan block row).
    user = await _find_user(db, customer_hash)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    row = (await db.execute(
        select(CustomerBlock).where(CustomerBlock.customer_hash == customer_hash)
    )).scalar_one_or_none()
    before = {"status": row.status, "reason": row.reason} if row else None
    if row is None:
        row = CustomerBlock(customer_hash=customer_hash)
        db.add(row)
    row.status = "blocked"
    row.reason = body.reason
    row.message = body.message
    row.actor = caller.customer_id

    notifications = await _dispatch_notifications(
        db, redis, customer_hash, body.reason, body, caller.customer_id,
    )

    after = {"status": "blocked", "reason": body.reason, "message": body.message}
    db.add(AdminAuditLog(
        actor=caller.customer_id,
        action="block_customer",
        target=customer_hash,
        before=before,
        after=after,
    ))
    # Surface the analyst block on the Fraud Intelligence dashboard too. Reports
    # are session-scoped, so attach it to the customer's most recent session
    # (best-effort — skipped if they have none yet).
    latest_sid = (await db.execute(
        select(DBSession.id).where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at)).limit(1)
    )).scalar_one_or_none()
    if latest_sid is not None:
        db.add(FraudReport(
            session_id=latest_sid,
            report_text=f"User {customer_hash} was blocked by analyst {caller.customer_id} — {body.reason}",
            risk_score=1000,
            trigger_signals={"threat_level": classify_threat(1000), "evidence": [body.reason], "analyst_block": True},
            analyst_action="Account blocked by analyst",
        ))
    await db.commit()
    # Mirror AFTER commit so the durable row is the source of truth even if Redis
    # is briefly unavailable — is_blocked() falls back to the DB row.
    await block_service.mirror_block(redis, customer_hash, body.reason)
    logger.info("Customer %s blocked by %s (reason=%s)", customer_hash[:12], caller.customer_id, body.reason)
    return {
        "status": "blocked",
        "reason": body.reason,
        "actor": caller.customer_id,
        "notifications": notifications,
    }


@router.post("/customers/{customer_hash}/unblock")
async def unblock_customer(
    customer_hash: str,
    body: UnblockRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(require_role(WRITE_ROLE)),  # write = admin only
):
    """Lift a fraud-analyst block (admin only). Clears the Redis mirror so the
    next /evaluate proceeds through the normal pathways. Optionally notifies the
    customer. Fully audited; the block row is kept (status=unblocked) for trail."""
    row = (await db.execute(
        select(CustomerBlock).where(CustomerBlock.customer_hash == customer_hash)
    )).scalar_one_or_none()
    before = {"status": row.status, "reason": row.reason} if row else None
    if row is not None:
        row.status = "unblocked"
        row.reason = body.reason or "manual"
        row.actor = caller.customer_id

    notifications = await _dispatch_notifications(
        db, redis, customer_hash, body.reason or "manual", body, caller.customer_id,
    )

    after = {"status": "unblocked", "reason": body.reason}
    db.add(AdminAuditLog(
        actor=caller.customer_id,
        action="unblock_customer",
        target=customer_hash,
        before=before,
        after=after,
    ))
    await db.commit()
    await block_service.mirror_unblock(redis, customer_hash)
    logger.info("Customer %s unblocked by %s", customer_hash[:12], caller.customer_id)
    return {
        "status": "unblocked",
        "actor": caller.customer_id,
        "notifications": notifications,
    }


@router.get("/customers/{customer_hash}/notifications")
async def list_notifications(
    customer_hash: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
    limit: int = Query(25, ge=1, le=100),
):
    """Notification history for one customer (analyst + admin may view)."""
    rows = (await db.execute(
        select(Notification).where(Notification.customer_hash == customer_hash)
        .order_by(desc(Notification.created_at)).limit(limit)
    )).scalars().all()
    return {
        "count": len(rows),
        "notifications": [
            {
                "id": str(n.id),
                "channel": n.channel,
                "to_address": n.to_address,
                "subject": n.subject,
                "body": n.body,
                "reason": n.reason,
                "status": n.status,
                "provider": n.provider,
                "actor": n.actor,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in rows
        ],
    }


# ── Audit log viewer (governance) ───────────────────────────────────────────
@router.get("/audit")
async def list_audit(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
    limit: int = Query(50, ge=1, le=200),
):
    """Recent privileged actions — surfaces the audit table the panel already writes to."""
    rows = (await db.execute(
        select(AdminAuditLog).order_by(desc(AdminAuditLog.ts)).limit(limit)
    )).scalars().all()
    return {
        "count": len(rows),
        "entries": [
            {
                "id": str(a.id),
                "actor": a.actor,
                "action": a.action,
                "target": a.target,
                "before": a.before,
                "after": a.after,
                "ts": a.ts.isoformat() if a.ts else None,
            }
            for a in rows
        ],
    }
