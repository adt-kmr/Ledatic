import time
import uuid
import asyncio
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.schemas import FraudReportRequest, FraudReportResponse
from app.models.db_models import Session as DBSession, FraudReport, User
from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthUser, get_current_user
from app.services.fraud_agent import run_fraud_investigation
from app.services.threat_level import classify as classify_threat

logger = logging.getLogger(__name__)
router = APIRouter()


class TransactionScoreRequest(BaseModel):
    transaction: dict[str, Any]


class TransactionBatchRequest(BaseModel):
    transactions: list[dict[str, Any]]


def _ml_headers() -> dict:
    h = {"Content-Type": "application/json"}
    # Import the shared resolver from auth module to avoid duplication.
    from app.api.auth import _resolve_internal_token
    h["X-Internal-Token"] = _resolve_internal_token()
    return h


async def _ml_post(path: str, payload: dict):
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{settings.ml_service_url}{path}", json=payload, headers=_ml_headers()
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code,
                            detail="ML transaction scorer error")
    except Exception as exc:  # noqa: BLE001
        logger.warning("ML transaction scorer unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="ML service unavailable")


@router.post("/score-transaction")
async def score_transaction(
    request: TransactionScoreRequest,
    caller: AuthUser = Depends(get_current_user),
):
    """Single-transaction INDICATIVE score (use /score-transactions for decisions)."""
    return await _ml_post("/score-transaction", {"transaction": request.transaction})


@router.post("/score-transactions")
async def score_transactions(
    request: TransactionBatchRequest,
    caller: AuthUser = Depends(get_current_user),
):
    """Batch fraud scoring with peer ranking — the reliable decision path."""
    return await _ml_post("/score-transactions", {"transactions": request.transactions})


@router.get("/reports")
async def list_fraud_reports(
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(get_current_user),
):
    """List all fraud reports with session metadata — for the analyst dashboard.

    Requires authentication. (In a real deployment this would be scoped to an
    analyst role; for the demo any authenticated user may view the worklist.)
    """
    from sqlalchemy import desc as sa_desc
    result = await db.execute(
        select(FraudReport, DBSession, User)
        .join(DBSession, FraudReport.session_id == DBSession.id)
        .join(User, DBSession.user_id == User.id)
        .order_by(sa_desc(FraudReport.created_at))
        .limit(50)
    )
    rows = result.all()
    
    from app.core.redis_client import _redis as redis_client
    reports_list = []
    for fr, s, u in rows:
        # Track WHERE the photo came from, and never pass an enrolment photo
        # off as the face behind the attempt.
        #
        # The last fallback returns the customer's registration selfie. On a
        # report about someone failing that customer's password, showing that
        # selfie unlabelled tells the analyst the account holder made the
        # attempt — the opposite of what happened. The photo is still useful
        # (it is who the account *should* be), so it is returned, but tagged so
        # the UI can say which one it is.
        face_source = None
        face = getattr(s, "face_image", None)
        if face:
            face_source = "attempt"          # captured during this session
        if not face and redis_client:
            try:
                face = await redis_client.get(f"session:{s.id}:face")
                if face:
                    face_source = "attempt"
            except Exception:
                pass

        if not face and redis_client:
            try:
                face = await redis_client.get(f"user:{u.customer_hash}:face")
                if face:
                    face_source = "enrolment"  # NOT the face behind this attempt
            except Exception:
                pass

        bundle = s.signal_bundle_json or {}
        ks_events = bundle.get("keystroke_events", []) or bundle.get("keystrokeEvents", []) or []
        m_events = bundle.get("mouse_events", []) or bundle.get("mouseEvents", []) or []
        t_events = bundle.get("touch_events", []) or bundle.get("touchEvents", []) or []
        
        reports_list.append({
            "report_id": str(fr.id),
            "session_id": str(fr.session_id),
            "user_id": u.customer_hash,
            "report_text": fr.report_text,
            "risk_score": fr.risk_score,
            # Derived at read time, not read back from trigger_signals.
            #
            # The label was frozen into the row when the report was written, by
            # whichever of four disagreeing scales that code path used. The
            # stored values are therefore not comparable to each other: a
            # risk-750 row says CRITICAL while a risk-762 row says HIGH, and
            # rows scored 0 say MEDIUM. Classifying from risk_score on read
            # makes every row — including the ones already written — agree,
            # and means changing a threshold relabels history instead of
            # leaving it stale.
            "threat_level": classify_threat(fr.risk_score),
            # What the row was originally labelled, kept so the change is
            # auditable rather than silently rewriting what an analyst saw.
            "threat_level_stored": (fr.trigger_signals or {}).get("threat_level"),
            "evidence": (fr.trigger_signals or {}).get("evidence", []),
            "recommended_action": fr.analyst_action,
            "confidence": (fr.trigger_signals or {}).get("confidence"),
            "decision": s.decision,
            "pathway": s.pathway,
            "channel": s.channel,
            "created_at": fr.created_at.isoformat() if fr.created_at else None,
            "face_image": face,
            # "attempt" = captured during this session; "enrolment" = the
            # account holder's registration photo, NOT whoever attempted this.
            "face_image_source": face_source,
            "keystroke_count": len(ks_events),
            "mouse_count": len(m_events),
            "touch_count": len(t_events),
            "mouse_events": m_events,
            "touch_events": t_events,
            # IP Intelligence fields
            "login_ip": s.login_ip,
            "login_country": s.login_country,
            "login_city": s.login_city,
            "vpn_detected": s.vpn_detected,
            "geo_distance_km": s.geo_distance_km,
            "ip_risk_score": s.ip_risk_score,
        })
    return reports_list


@router.post("/report", response_model=FraudReportResponse)
async def generate_fraud_report(
    request: FraudReportRequest,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(get_current_user),
):
    start = time.time()

    # Validate session_id
    try:
        session_id_parsed = uuid.UUID(request.session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    # Fetch session from DB. The /evaluate endpoint persists the session via a
    # FastAPI BackgroundTask that runs AFTER its response is sent, so an
    # immediate follow-up report request can race the commit and 404 on a fast
    # click. Poll briefly for the row to appear instead of failing instantly.
    session = None
    for _attempt in range(8):
        result = await db.execute(
            select(DBSession).where(DBSession.id == session_id_parsed)
        )
        session = result.scalar_one_or_none()
        if session is not None:
            break
        await asyncio.sleep(0.15)  # ~1.2s max total, well within report latency
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get user customer_hash from user_id FK
    user_result = await db.execute(
        select(User).where(User.id == session.user_id)
    )
    user = user_result.scalar_one_or_none()
    # Only the session owner or a bank admin/analyst may generate a report.
    is_analyst = caller.customer_id in ("ADMIN", "BANK") or caller.bank_id == "FIU"
    is_owner = user and user.customer_hash == caller.user_hash
    if not (is_analyst or is_owner):
        raise HTTPException(status_code=403, detail="Not authorized to report this session")
    user_id = user.customer_hash

    report = await run_fraud_investigation(
        session_id=request.session_id,
        user_id=user_id,
        user_hash=user.customer_hash,
        decision=session.decision or "UNKNOWN",
        risk_score=session.risk_score or 0,
        pathway=session.pathway or "UNKNOWN",
    )

    latency = int((time.time() - start) * 1000)
    report_id = str(uuid.uuid4())

    # Persist report to DB
    try:
        fraud_row = FraudReport(
            id=uuid.UUID(report_id),
            session_id=session.id,
            report_text=report.get("summary", ""),
            risk_score=session.risk_score,
            trigger_signals={
                "threat_level": report.get("threat_level"),
                "evidence": report.get("evidence", []),
                "recommended_action": report.get("recommended_action"),
                "confidence": report.get("confidence"),
            },
            analyst_action=report.get("recommended_action"),
        )
        db.add(fraud_row)
        await db.commit()
    except Exception as exc:
        logger.error("Failed to persist fraud report: %s", exc)
        await db.rollback()

    # Build full report text for response
    evidence_lines = "\n".join(f"  • {e}" for e in report.get("evidence", []))
    report_text = (
        f"[{report.get('threat_level', 'HIGH')}] {report.get('summary', '')}\n\n"
        f"Evidence:\n{evidence_lines}\n\n"
        f"Action: {report.get('recommended_action', 'Review manually')}\n"
        f"Confidence: {report.get('confidence', 0.7):.0%}"
    )

    return FraudReportResponse(
        report_id=report_id,
        session_id=request.session_id,
        report_text=report_text,
        risk_score=session.risk_score or 0,
        latency_ms=latency,
        threat_level=report.get("threat_level"),
        evidence=report.get("evidence", []),
        recommended_action=report.get("recommended_action"),
        confidence=report.get("confidence"),
        session_context={
            "decision": session.decision,
            "pathway": session.pathway,
            "channel": session.channel,
            "created_at": session.created_at.isoformat() if session.created_at else None,
        },
    )
