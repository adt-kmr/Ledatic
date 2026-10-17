"""
Citadel — Voice MFA API
===========================

Outbound verification call placed at registration (see services/vapi_client.py
for the three questions and why they were chosen).

Endpoints
    POST /api/voice-mfa/initiate      place the call, create the PENDING row
    GET  /api/voice-mfa/status/{id}   poll for the verdict (registration waits on this)
    POST /api/voice-mfa/webhook       Vapi end-of-call report → verdict
    POST /api/voice-mfa/simulate/{id} demo control: complete a call without dialling
    GET  /api/voice-mfa/verifications FIU console list

Registration is BLOCKING on this: the account is not usable until a verdict
lands. But an unanswered call is STEP_UP, never HARD_BLOCK — a customer must
not be locked out by a bad mobile network.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.redis_client import get_redis
from app.core.security import AuthUser, require_role
from app.models.db_models import (
    AdminAuditLog,
    CustomerBlock,
    DeviceFingerprint,
    User,
    VoiceMfaVerification,
)
from app.services import vapi_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice-mfa", tags=["Voice MFA"])

VIEW_ROLES = ("fiu_admin", "bank_analyst")


# ── Schemas ──────────────────────────────────────────────────────────────────

class InitiateRequest(BaseModel):
    customer_hash: Optional[str] = None
    customer_id: Optional[str] = None
    # Optional overrides — normally read from the user row.
    phone_number: Optional[str] = None
    name: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def _e164(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        s = v.strip().replace(" ", "").replace("-", "")
        if not s.startswith("+") or not s[1:].isdigit() or not (8 <= len(s) <= 16):
            raise ValueError("phone_number must be E.164, e.g. +919876543210")
        return s


class InitiateResponse(BaseModel):
    verification_id: str
    call_id: Optional[str]
    status: str
    simulated: bool
    expected_city: Optional[str] = None
    message: str


class StatusResponse(BaseModel):
    verification_id: str
    status: str
    decision: Optional[str] = None
    risk_score: int = 0
    q1_registered: Optional[bool] = None
    q2_not_coerced: Optional[bool] = None
    q3_location_match: Optional[bool] = None
    failure_reason: Optional[str] = None
    simulated: bool = False
    # What the verdict actually DID — so the UI can show that a block really
    # blocked, rather than the caller having to take it on trust.
    account_blocked: bool = False
    persisted_session_id: Optional[str] = None
    blockchain_anchor: Optional[dict] = None


class SimulateRequest(BaseModel):
    """Demo control — complete a pending verification without a real call."""
    q1_registered: Optional[bool] = True
    q2_not_coerced: Optional[bool] = True
    q3_location_match: Optional[bool] = True


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _resolve_user(db: AsyncSession, body: InitiateRequest) -> Optional[User]:
    if body.customer_hash:
        r = await db.execute(
            select(User).where(func.lower(User.customer_hash) == body.customer_hash.lower())
        )
        u = r.scalar_one_or_none()
        if u:
            return u
    if body.customer_id:
        r = await db.execute(
            select(User).where(func.lower(User.customer_id) == body.customer_id.lower())
        )
        return r.scalar_one_or_none()
    return None


async def _registered_city(db: AsyncSession, user_id) -> Optional[str]:
    """City captured at registration — what question 3 is asked against."""
    r = await db.execute(
        select(DeviceFingerprint).where(DeviceFingerprint.user_id == user_id)
    )
    fp = r.scalar_one_or_none()
    return fp.registered_city if fp else None


async def publish_voice_event(row: VoiceMfaVerification, redis) -> None:
    """
    Announce a completed voice verification on the live FIU feed.

    Publishes to `btic:events`, the same Redis channel auth.py uses for session
    evaluations and that /api/btic/events/stream relays over SSE — so the
    console gets voice results through the pipe it is already listening on,
    with no second stream to manage.

    Best-effort: the verdict itself must not depend on the notification.
    """
    if redis is None:
        return
    try:
        import json as _json
        await redis.publish("btic:events", _json.dumps({
            "type": "voice_mfa",
            "purpose": row.purpose or "registration",
            "verification_id": str(row.id),
            "customer_hash": row.customer_hash,
            "decision": row.decision,
            "risk_score": row.risk_score or 0,
            "q1": row.q1_registered,
            "q2": row.q2_not_coerced,
            "q3": row.q3_location_match,
            "failure_reason": row.failure_reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Voice-MFA event publish skipped: %s", exc)


async def _enforce_verdict(row: VoiceMfaVerification, redis) -> dict:
    """
    Make a voice verdict actually bite, instead of being an advisory score.

    Three things happen, all reusing machinery that already exists rather than
    inventing a parallel path:

      1. HARD_BLOCK writes a CustomerBlock row + the Redis mirror, which is the
         SAME gate the login/evaluate path already checks. So the account is
         genuinely unusable — not merely hidden behind a disabled button in the
         registration UI, which a client could bypass by navigating straight to
         the login screen.
      2. The verdict is persisted as a SECURITY_GATE session + FraudReport, so
         it lands in the FIU fraud worklist next to every other detection.
      3. A HARD_BLOCK is anchored on Hyperledger, Dilithium-signed, like the
         other advanced-security blocks.

    All best-effort: a failure here must never break the verification response.
    """
    from app.services import blocks as block_service
    from app.services import security_integration as si

    out: dict[str, Any] = {"blocked": False, "persisted_session_id": None, "anchor": None}

    # Announce EVERY completed verification, including APPROVE — the console
    # wants to see successful sign-ins too, not just the failures. Published
    # before the early return below so a clean result is not swallowed.
    await publish_voice_event(row, redis)

    if row.decision not in ("HARD_BLOCK", "STEP_UP"):
        return out

    verdicts = {
        "voice_mfa": row.status,
        "purpose": row.purpose,
        "q1_registered": row.q1_registered,
        "q2_not_coerced": row.q2_not_coerced,
        "q3_location_match": row.q3_location_match,
        # Sensor truth, so _trigger_of can tell a device contradiction apart
        # from an honest "this is a new device".
        "usual_device": row.usual_device,
        "expected_city": row.expected_city,
    }
    notes = [row.failure_reason] if row.failure_reason else []

    # Post-quantum sign the verdict, as the security gate does. Without this
    # the on-chain anchor carried an EMPTY signature field, so the record could
    # not be shown to be authentic after the fact — which is most of the point
    # of anchoring it.
    dilithium_signature: Optional[str] = None
    pqc_algorithm: Optional[str] = None
    try:
        from app.services.pqc_signer import get_pqc_signer
        pqc = get_pqc_signer()
        if pqc and pqc.available:
            sig = pqc.sign_behavioral_hash({
                "verification_id": str(row.id),
                "customer_hash": row.customer_hash,
                "decision": row.decision,
                "risk_score": row.risk_score,
                "purpose": row.purpose,
                "q1": row.q1_registered, "q2": row.q2_not_coerced, "q3": row.q3_location_match,
            })
            dilithium_signature = sig.signature_b64
            pqc_algorithm = sig.algorithm
    except Exception as exc:  # noqa: BLE001
        logger.debug("Voice verdict PQC signing skipped: %s", exc)

    # 1 — enforce the block through the existing customer-block gate
    if row.decision == "HARD_BLOCK" and row.customer_hash and row.customer_hash != "unknown":
        try:
            async with AsyncSessionLocal() as db2:
                existing = (await db2.execute(
                    select(CustomerBlock).where(CustomerBlock.customer_hash == row.customer_hash)
                )).scalar_one_or_none()
                if existing is None:
                    existing = CustomerBlock(customer_hash=row.customer_hash)
                    db2.add(existing)
                existing.status = "blocked"
                # Distinguishes a voice-MFA block from an analyst block in the
                # audit trail and in the customer-facing notification template.
                existing.reason = (
                    "voice_mfa_identity" if row.q1_registered is False
                    else "voice_mfa_coercion" if row.q2_not_coerced is False
                    else "voice_mfa_failed"
                )
                existing.message = row.failure_reason
                existing.actor = "voice-mfa"
                db2.add(AdminAuditLog(
                    actor="voice-mfa",
                    action="block_customer",
                    target=row.customer_hash,
                    before=None,
                    after={"status": "blocked", "reason": existing.reason,
                           "verification_id": str(row.id)},
                ))
                await db2.commit()
            if redis is not None:
                await block_service.mirror_block(redis, row.customer_hash, "voice_mfa")
            out["blocked"] = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Voice-MFA block enforcement failed (non-fatal): %s", exc)

    # 2 — surface in the FIU fraud worklist
    try:
        out["persisted_session_id"] = await si.persist_security_verdict(
            session_id=str(row.id),
            customer_hash=row.customer_hash,
            decision=row.decision,
            security_risk=row.risk_score or 0,
            verdicts=verdicts,
            notes=notes,
            dilithium_signature=dilithium_signature,
            pqc_algorithm=pqc_algorithm,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Voice-MFA persistence failed (non-fatal): %s", exc)

    # 3 — anchor a block on-chain
    if row.decision == "HARD_BLOCK":
        try:
            out["anchor"] = await si.anchor_security_verdict(
                customer_hash=row.customer_hash,
                session_id=str(row.id),
                decision=row.decision,
                security_risk=row.risk_score or 0,
                verdicts=verdicts,
                dilithium_signature=dilithium_signature,
                pqc_algorithm=pqc_algorithm,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Voice-MFA anchoring skipped: %s", exc)

    return out


def _apply_verdict(row: VoiceMfaVerification) -> None:
    """Run the answers through the verdict function and stamp the row."""
    risk, decision, reason = vapi_client.evaluate_answers(
        row.q1_registered, row.q2_not_coerced, row.q3_location_match,
        purpose=row.purpose or "registration",
        usual_device=row.usual_device,
    )
    row.risk_score = risk
    row.decision = decision
    row.failure_reason = reason
    row.status = (
        "VERIFIED" if decision == "APPROVE"
        else "NO_ANSWER" if reason and "not answered" in reason
        else "FAILED"
    )
    row.completed_at = datetime.now(timezone.utc)


# ── Initiate ─────────────────────────────────────────────────────────────────

@router.post("/initiate", response_model=InitiateResponse)
async def initiate(body: InitiateRequest, db: AsyncSession = Depends(get_db)):
    """Place the verification call and open a PENDING record."""
    user = await _resolve_user(db, body)

    phone = body.phone_number or (user.phone_number if user else None)
    name = body.name or (user.name if user else None) or "there"
    chash = (user.customer_hash if user else None) or body.customer_hash or body.customer_id or "unknown"

    if not phone:
        raise HTTPException(
            status_code=400,
            detail="No phone number on file for this customer — cannot place a verification call.",
        )

    city = await _registered_city(db, user.id) if user else None

    # The row is written BEFORE dialling so a provider outage still leaves an
    # auditable record instead of a silent gap.
    row = VoiceMfaVerification(
        user_id=user.id if user else None,
        customer_hash=chash,
        phone_number=phone,
        status="PENDING",
        expected_city=city,
    )
    db.add(row)
    await db.flush()

    result = await vapi_client.place_verification_call(
        phone_number=phone,
        name=name,
        city=city,
        metadata={"verification_id": str(row.id), "customer_hash": chash},
    )

    row.call_id = result.call_id
    if not result.ok:
        # Telephony failure is not the customer's fault — step up, don't block.
        row.status = "ERROR"
        row.decision = "STEP_UP"
        row.risk_score = vapi_client.RISK_NO_ANSWER
        row.failure_reason = f"could not place call: {result.reason}"
        row.completed_at = datetime.now(timezone.utc)

    await db.commit()

    return InitiateResponse(
        verification_id=str(row.id),
        call_id=result.call_id,
        status=row.status,
        simulated=result.simulated,
        expected_city=city,
        message=(
            "Simulated verification call (Vapi not configured)"
            if result.simulated
            else "Verification call placed" if result.ok
            else f"Call could not be placed: {result.reason}"
        ),
    )


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/status/{verification_id}", response_model=StatusResponse)
async def status(verification_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Poll a verification. Registration blocks on this reaching a terminal state."""
    r = await db.execute(
        select(VoiceMfaVerification).where(VoiceMfaVerification.id == verification_id)
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Verification not found")

    # If the webhook never landed, fall back to reading the call from Vapi.
    if row.status == "PENDING" and row.call_id:
        call = await vapi_client.fetch_call(row.call_id)
        if call and call.get("status") == "ended":
            _ingest_call_payload(row, call)
            _apply_verdict(row)
            await db.commit()

    return StatusResponse(
        verification_id=str(row.id),
        status=row.status,
        decision=row.decision,
        risk_score=row.risk_score or 0,
        q1_registered=row.q1_registered,
        q2_not_coerced=row.q2_not_coerced,
        q3_location_match=row.q3_location_match,
        failure_reason=row.failure_reason,
        simulated=bool(row.call_id and row.call_id.startswith("sim-")),
    )


def _ingest_call_payload(row: VoiceMfaVerification, call: dict[str, Any]) -> None:
    """Copy transcript / recording / structured answers off a Vapi call object."""
    analysis = call.get("analysis") or {}
    sd = analysis.get("structuredData") or {}
    if isinstance(sd, dict):
        row.structured_data = sd
        if "q1_registered" in sd:
            row.q1_registered = _as_bool(sd.get("q1_registered"))
        if "q2_not_coerced" in sd:
            row.q2_not_coerced = _as_bool(sd.get("q2_not_coerced"))
        if "q3_location_match" in sd:
            row.q3_location_match = _as_bool(sd.get("q3_location_match"))
    row.transcript = call.get("transcript") or row.transcript
    row.recording_url = call.get("recordingUrl") or row.recording_url


def _as_bool(v: Any) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "y", "1"):
            return True
        if s in ("false", "no", "n", "0"):
            return False
    return None


# ── Webhook ──────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Vapi server events. We act on `end-of-call-report`, which carries the
    structured extraction; other event types are acknowledged and ignored.

    Verified against the shared secret when one is configured. Vapi sends it in
    `x-vapi-secret`; a mismatch is rejected rather than trusted.
    """
    if settings.vapi_webhook_secret:
        sent = request.headers.get("x-vapi-secret", "")
        if sent != settings.vapi_webhook_secret:
            raise HTTPException(status_code=401, detail="bad webhook secret")
    elif settings.vapi_private_key and settings.vapi_phone_number_id:
        # Real calls are being placed but the webhook is unauthenticated —
        # anyone who finds the URL can forge end-of-call verdicts.
        logger.warning(
            "Voice-MFA webhook has no VAPI_WEBHOOK_SECRET configured while Vapi "
            "is in real-call mode — set the secret to authenticate verdicts."
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON")

    msg = body.get("message") or body
    if msg.get("type") != "end-of-call-report":
        return {"received": True, "ignored": msg.get("type")}

    call = msg.get("call") or {}
    call_id = call.get("id") or msg.get("callId")
    if not call_id:
        return {"received": True, "ignored": "no call id"}

    r = await db.execute(
        select(VoiceMfaVerification).where(VoiceMfaVerification.call_id == call_id)
    )
    row = r.scalar_one_or_none()
    if not row:
        logger.warning("Voice-MFA webhook for unknown call %s", call_id)
        return {"received": True, "ignored": "unknown call"}

    # The report carries analysis/transcript at the message level too.
    merged = {**call, "analysis": msg.get("analysis") or call.get("analysis"),
              "transcript": msg.get("transcript") or call.get("transcript"),
              "recordingUrl": msg.get("recordingUrl") or call.get("recordingUrl")}
    _ingest_call_payload(row, merged)
    _apply_verdict(row)
    await db.commit()

    logger.info(
        "Voice MFA %s → %s (risk %s) %s",
        row.id, row.decision, row.risk_score, row.failure_reason or "",
    )
    return {"received": True, "decision": row.decision}


# ── Demo control ─────────────────────────────────────────────────────────────

@router.post("/simulate/{verification_id}", response_model=StatusResponse)
async def simulate(
    verification_id: uuid.UUID,
    body: SimulateRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    caller: AuthUser = Depends(require_role("fiu_admin")),
):
    """
    Complete a PENDING verification with chosen answers, without a real call.

    This is how the failure paths (identity theft, coercion) are demonstrated on
    stage — you cannot ask a live volunteer to answer "no, someone is coercing
    me" on a real phone call, and it costs nothing to run.
    """
    r = await db.execute(
        select(VoiceMfaVerification).where(VoiceMfaVerification.id == verification_id)
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Verification not found")

    row.q1_registered = body.q1_registered
    row.q2_not_coerced = body.q2_not_coerced
    row.q3_location_match = body.q3_location_match
    row.structured_data = {**(row.structured_data or {}), "simulated": True}
    _apply_verdict(row)
    await db.commit()
    # Simulated verdicts enforce identically — otherwise the demo would show a
    # block that did not actually block anything.
    enf = await _enforce_verdict(row, redis)

    return StatusResponse(
        verification_id=str(row.id),
        status=row.status,
        decision=row.decision,
        risk_score=row.risk_score or 0,
        q1_registered=row.q1_registered,
        q2_not_coerced=row.q2_not_coerced,
        q3_location_match=row.q3_location_match,
        failure_reason=row.failure_reason,
        simulated=True,
        account_blocked=enf["blocked"],
        persisted_session_id=enf["persisted_session_id"],
        blockchain_anchor=enf["anchor"],
    )


# ── FIU console list ─────────────────────────────────────────────────────────

@router.get("/verifications")
async def list_verifications(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(require_role(*VIEW_ROLES)),
):
    """Recent voice-MFA verifications for the fraud-ops console."""
    r = await db.execute(
        select(VoiceMfaVerification)
        .order_by(desc(VoiceMfaVerification.created_at))
        .limit(min(limit, 200))
    )
    rows = r.scalars().all()
    return [
        {
            "verification_id": str(x.id),
            "customer_hash": x.customer_hash,
            "phone_last4": (x.phone_number or "")[-4:],
            "status": x.status,
            "decision": x.decision,
            "risk_score": x.risk_score,
            "q1_registered": x.q1_registered,
            "q2_not_coerced": x.q2_not_coerced,
            "q3_location_match": x.q3_location_match,
            "expected_city": x.expected_city,
            "failure_reason": x.failure_reason,
            "simulated": bool(x.call_id and x.call_id.startswith("sim-")),
            "created_at": x.created_at.isoformat() if x.created_at else None,
            "completed_at": x.completed_at.isoformat() if x.completed_at else None,
        }
        for x in rows
    ]


# ── Web SDK (browser voice call — no phone number needed) ────────────────────

class WebStartRequest(BaseModel):
    customer_hash: Optional[str] = None
    customer_id: Optional[str] = None
    name: Optional[str] = None
    # 'registration' (default) or 'login' — selects the question set.
    purpose: str = "registration"
    # Sensor truth at call time: did the device fingerprint match the baseline?
    # The caller's answer to Q3 is compared against this on the login path.
    usual_device: Optional[bool] = None


class WebStartResponse(BaseModel):
    verification_id: str
    public_key: str
    assistant: dict
    expected_city: Optional[str] = None


@router.post("/web/start", response_model=WebStartResponse)
async def web_start(body: WebStartRequest, db: AsyncSession = Depends(get_db)):
    """
    Open a verification for an in-browser voice call.

    The assistant (greeting, the three questions, the extraction schema) is
    built HERE, server-side, and handed to the browser to run. The browser is
    only a microphone and speaker — it never decides what is asked, so the
    questions cannot be edited from devtools.

    No phone number is involved, so this works from any country and is not
    subject to the international-calling limits of a Vapi/Twilio number.
    """
    user = await _resolve_user(
        db, InitiateRequest(customer_hash=body.customer_hash, customer_id=body.customer_id)
    )
    name = body.name or (user.name if user else None) or "there"
    chash = (user.customer_hash if user else None) or body.customer_hash or body.customer_id or "unknown"
    city = await _registered_city(db, user.id) if user else None

    row = VoiceMfaVerification(
        user_id=user.id if user else None,
        customer_hash=chash,
        phone_number=None,          # browser call — there is no dialled number
        status="PENDING",
        expected_city=city,
        purpose=body.purpose,
        usual_device=body.usual_device,
    )
    db.add(row)
    await db.commit()

    return WebStartResponse(
        verification_id=str(row.id),
        public_key=settings.vapi_public_key,
        assistant=vapi_client.build_assistant(
            name, city, purpose=body.purpose,
            usual_device=body.usual_device is not False,
        ),
        expected_city=city,
    )


class WebCompleteRequest(BaseModel):
    verification_id: str
    call_id: Optional[str] = None


@router.post("/web/complete", response_model=StatusResponse)
async def web_complete(
    body: WebCompleteRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Finalise a browser verification.

    SECURITY: the browser sends only the Vapi call id — never the answers. The
    server then fetches that call from Vapi itself and reads the structured
    extraction from the authoritative source. A tampered client can therefore
    claim a call happened, but cannot claim what was said in it.
    """
    r = await db.execute(
        select(VoiceMfaVerification).where(VoiceMfaVerification.id == body.verification_id)
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Verification not found")

    if body.call_id:
        row.call_id = body.call_id

    if row.call_id:
        # Vapi finishes its post-call analysis a beat after the call ends, so
        # give it a few tries before falling back to "unanswered".
        import asyncio
        call = None
        for attempt in range(6):
            call = await vapi_client.fetch_call(row.call_id)
            if call and (call.get("analysis") or {}).get("structuredData"):
                break
            await asyncio.sleep(2)
        if call:
            _ingest_call_payload(row, call)

    _apply_verdict(row)
    await db.commit()
    enf = await _enforce_verdict(row, redis)

    return StatusResponse(
        verification_id=str(row.id),
        status=row.status,
        decision=row.decision,
        risk_score=row.risk_score or 0,
        q1_registered=row.q1_registered,
        q2_not_coerced=row.q2_not_coerced,
        q3_location_match=row.q3_location_match,
        failure_reason=row.failure_reason,
        simulated=False,
        account_blocked=enf["blocked"],
        persisted_session_id=enf["persisted_session_id"],
        blockchain_anchor=enf["anchor"],
    )


@router.get("/config")
async def config_status():
    """Whether real calls can be placed — drives the UI's simulated badge."""
    # Web mode needs only the public key (browser) + private key (server-side
    # result fetch). It does NOT need a phone number, which is why it works
    # from India where the Twilio/Vapi number could not place the call.
    web_ready = bool(settings.vapi_public_key and settings.vapi_private_key)
    return {
        "configured": vapi_client.is_configured(),
        "enabled": settings.vapi_enabled,
        "has_private_key": bool(settings.vapi_private_key),
        "has_public_key": bool(settings.vapi_public_key),
        "has_phone_number_id": bool(settings.vapi_phone_number_id),
        "phone_mode": "live" if vapi_client.is_configured() else "simulated",
        "web_ready": web_ready,
        "mode": "web" if web_ready else "simulated",
    }
