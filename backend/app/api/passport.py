import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.models.schemas import PassportResponse, PassportChannel, Channel
from app.models.db_models import User, BehavioralPassport, Session as DBSession
from app.core.database import get_db
from app.core.security import AuthUser, get_current_user, DEMO_ACCOUNTS

logger = logging.getLogger(__name__)
router = APIRouter()

_ALL_CHANNELS = [Channel.UPI, Channel.MOBILE, Channel.INTERNET]


@router.get("/{user_id}", response_model=PassportResponse)
async def get_passport(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(get_current_user),
):
    # A user may only view their own behavioral passport — no cross-user reads.
    # Demo exception: an authenticated caller (an "analyst" for the hackathon
    # demo) may view any of the two seeded demo accounts (Harsh / Deepesh) so
    # the passport feature is demonstrable end-to-end. Production would scope
    # this to an analyst role; non-demo user_ids stay 403.
    if user_id != caller.customer_id and user_id not in DEMO_ACCOUNTS:
        raise HTTPException(status_code=403, detail="Not authorized to view this passport")

    # Look up user by customer_hash (= user_id from frontend)
    result = await db.execute(
        select(User).where(User.customer_hash == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        # User hasn't enrolled yet — return empty passport
        return PassportResponse(
            user_id=user_id,
            channels=[
                PassportChannel(channel=ch, is_enrolled=False, enrollment_shots=0)
                for ch in _ALL_CHANNELS
            ],
            total_sessions=0,
            last_seen=None,
            recent_decisions=[],
        )

    # Fetch passport records for all channels
    passport_result = await db.execute(
        select(BehavioralPassport).where(BehavioralPassport.user_id == user.id)
    )
    passports = {p.channel: p for p in passport_result.scalars().all()}

    channels = []
    for ch in _ALL_CHANNELS:
        p = passports.get(ch.value)
        channels.append(PassportChannel(
            channel=ch,
            is_enrolled=p.is_enrolled if p else False,
            enrollment_shots=p.enrollment_shots if p else 0,
            updated_at=p.updated_at.isoformat() if p and p.updated_at else None,
        ))

    # Fetch recent sessions (last 10)
    sessions_result = await db.execute(
        select(DBSession)
        .where(DBSession.user_id == user.id)
        .order_by(desc(DBSession.created_at))
        .limit(10)
    )
    sessions = sessions_result.scalars().all()

    recent_decisions = [
        {
            "session_id": str(s.id),
            "decision": s.decision,
            "risk_score": s.risk_score,
            "pathway": s.pathway,
            "channel": s.channel,
            "latency_ms": s.latency_ms,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]

    last_seen = sessions[0].created_at.isoformat() if sessions else None

    return PassportResponse(
        user_id=user_id,
        channels=channels,
        total_sessions=len(sessions),
        last_seen=last_seen,
        recent_decisions=recent_decisions,
    )
