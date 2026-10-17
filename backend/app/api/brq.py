"""
Citadel — Behavioral Registration Questionnaire (BRQ) API

5 cybersecurity-focused questions asked once at registration to establish
a user's behavioral and risk baseline. Answers are stored in Postgres and
surfaced to analysts in the admin dashboard for context during investigations.
"""
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthUser, get_current_user, derive_user_hash
from app.models.db_models import User, BRQAnswer

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Static BRQ Question Bank ─────────────────────────────────────────────────
BRQ_QUESTIONS = [
    {
        "id": "q1",
        "question": "How many different countries or cities have you traveled to in the last 12 months?",
        "type": "single_choice",
        "options": [
            "None — I rarely travel",
            "1–2 cities/countries",
            "3–5 cities/countries",
            "More than 5 — I travel frequently",
        ],
        "security_note": "Establishes your geographic mobility baseline to distinguish legitimate overseas logins from SIM-swap attacks.",
    },
    {
        "id": "q2",
        "question": "On average, how many times per week do you use internet banking or UPI apps?",
        "type": "single_choice",
        "options": [
            "Rarely (less than once a week)",
            "1–3 times per week",
            "4–7 times per week",
            "Multiple times a day",
        ],
        "security_note": "Sets your usage frequency baseline. A sudden burst of activity on an inactive account is a key fraud signal.",
    },
    {
        "id": "q3",
        "question": "Do you ever use shared computers, public Wi-Fi, or cybercafés to access your bank account?",
        "type": "single_choice",
        "options": [
            "Never — I only use my personal devices on trusted networks",
            "Occasionally, on trusted public Wi-Fi only",
            "Sometimes, from any available network",
            "Yes, regularly from shared/public devices",
        ],
        "security_note": "Identifies shared-device and public-network risk exposure for your account.",
    },
    {
        "id": "q4",
        "question": "If you received an OTP (one-time password) on your phone that you did NOT request, what would you do?",
        "type": "single_choice",
        "options": [
            "Ignore it and do nothing",
            "Call my bank immediately to report it",
            "Share it if asked by someone claiming to be bank support",
            "Not sure what to do",
        ],
        "security_note": "Measures social engineering and phishing susceptibility — a key predictor of SIM-swap victim likelihood.",
        "correct_answer_index": 1,
    },
    {
        "id": "q5",
        "question": "How often do you allow family members to use your phone for making payments or UPI transfers?",
        "type": "single_choice",
        "options": [
            "Never — only I use my phone for payments",
            "Rarely, only in emergencies",
            "Sometimes, with my supervision",
            "Regularly — family members use it independently",
        ],
        "security_note": "Prevents false positives by establishing whether multi-user device behavior is expected for your account.",
    },
]


def _compute_risk_profile(answers: dict) -> tuple[str, int]:
    """
    Compute a behavioral risk label and integer score from BRQ answers.
    Returns (label, score) where label is 'low' | 'medium' | 'high'.
    """
    score = 0

    # Q3: Public Wi-Fi / shared devices
    q3 = answers.get("q3", "")
    if "regularly" in q3.lower() or "shared/public" in q3.lower():
        score += 30
    elif "sometimes" in q3.lower():
        score += 15
    elif "occasionally" in q3.lower():
        score += 5

    # Q4: OTP phishing susceptibility (wrong answers add risk)
    q4 = answers.get("q4", "")
    if "share it" in q4.lower() or "bank support" in q4.lower():
        score += 40  # High risk — phishing victim
    elif "not sure" in q4.lower() or "ignore" in q4.lower():
        score += 20

    # Q5: Shared device behavior
    q5 = answers.get("q5", "")
    if "regularly" in q5.lower() or "independently" in q5.lower():
        score += 15
    elif "sometimes" in q5.lower():
        score += 8

    label = "low" if score <= 20 else ("medium" if score <= 45 else "high")
    return label, score


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/questions")
async def get_questions():
    """Return the full BRQ question bank. No auth required (shown before registration completes)."""
    return {"questions": BRQ_QUESTIONS, "total": len(BRQ_QUESTIONS)}


class BRQSubmitRequest(BaseModel):
    customer_id: str
    bank_id: str = "PSB"
    answers: dict  # {q1: "option text", q2: "option text", ...}


class BRQSubmitResponse(BaseModel):
    status: str
    risk_profile: str
    risk_score: int
    message: str


@router.post("/submit", response_model=BRQSubmitResponse)
async def submit_brq(
    req: BRQSubmitRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Store BRQ answers for a user and compute their behavioral risk profile.
    Requires JWT — customer_id in the body must match the authenticated caller.
    """
    if caller.customer_id != req.customer_id:
        raise HTTPException(status_code=403, detail="customer_id does not match authenticated user")
    if caller.bank_id != req.bank_id:
        raise HTTPException(status_code=403, detail="bank_id does not match authenticated user")

    user_hash = derive_user_hash(req.bank_id, req.customer_id)

    result = await db.execute(select(User).where(User.customer_hash == user_hash))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Please complete registration first.")

    # Upsert BRQ answers
    existing = await db.execute(select(BRQAnswer).where(BRQAnswer.user_id == user.id))
    brq_row = existing.scalar_one_or_none()

    risk_label, risk_score = _compute_risk_profile(req.answers)

    if brq_row:
        brq_row.answers = req.answers
        brq_row.risk_profile = risk_label
        brq_row.risk_score_computed = risk_score
    else:
        brq_row = BRQAnswer(
            id=uuid.uuid4(),
            user_id=user.id,
            answers=req.answers,
            risk_profile=risk_label,
            risk_score_computed=risk_score,
        )
        db.add(brq_row)

    await db.commit()

    messages = {
        "low": "Your security profile looks great! Your account has strong baseline protection.",
        "medium": "Your profile is set up. We recommend enabling extra verification for high-value transfers.",
        "high": "Your profile indicates elevated risk exposure. Please review your security settings.",
    }

    return BRQSubmitResponse(
        status="success",
        risk_profile=risk_label,
        risk_score=risk_score,
        message=messages[risk_label],
    )


@router.get("/profile/{customer_id}")
async def get_brq_profile(
    customer_id: str,
    bank_id: str = "PSB",
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch a user's BRQ profile. Admin use only — requires valid JWT."""
    # If customer_id looks like a SHA-256 hash, treat it directly as user_hash
    if len(customer_id) == 64 and all(c in "0123456789abcdef" for c in customer_id.lower()):
        user_hash = customer_id
    else:
        user_hash = derive_user_hash(bank_id, customer_id)
        
    result = await db.execute(select(User).where(User.customer_hash == user_hash))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    brq_result = await db.execute(select(BRQAnswer).where(BRQAnswer.user_id == user.id))
    brq = brq_result.scalar_one_or_none()
    if not brq:
        return {"available": False, "message": "No BRQ profile on file for this user."}

    return {
        "available": True,
        "risk_profile": brq.risk_profile,
        "risk_score": brq.risk_score_computed,
        "answers": brq.answers,
        "created_at": brq.created_at.isoformat() if brq.created_at else None,
        "questions": {q["id"]: q["question"] for q in BRQ_QUESTIONS},
    }
