"""
Citadel — CAMARA Telecom API Mock
Simulates GSMA CAMARA Device Status API for hackathon demo.
Provides SIM swap detection + network risk signals for Pathway 2 enrichment.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Citadel CAMARA Mock", version="1.0.0")

# ── Pre-seeded network profiles for demo users ─────────────────────────────
# Mirrors the blockchain IMEI baselines in demo_setup.sh
NETWORK_PROFILES: dict[str, dict] = {
    "user-legit-001": {
        "sim_swapped_recently": False,
        "days_since_sim_swap":  730,        # 2 years — established SIM
        "roaming":              False,
        "network_risk_score":   0.04,
        "risk_factors":         [],
        "carrier":              "Jio",
        "circle":               "Delhi NCR",
        "account_age_days":     1825,       # 5 years
        "sim_swap_count_90d":   0,
    },
    "attacker-sim-swap": {
        "sim_swapped_recently": True,
        "days_since_sim_swap":  0,          # swapped TODAY
        "roaming":              False,
        "network_risk_score":   0.94,
        "risk_factors":         [
            "SIM_SWAP_LAST_24H",
            "NEW_DEVICE_FIRST_TRANSACTION",
            "MSISDN_PORT_DETECTED",
        ],
        "carrier":              "Airtel",
        "circle":               "Mumbai",
        "account_age_days":     3,
        "sim_swap_count_90d":   2,
    },
    "demo-user-harshdeep": {
        "sim_swapped_recently": False,
        "days_since_sim_swap":  365,
        "roaming":              False,
        "network_risk_score":   0.06,
        "risk_factors":         [],
        "carrier":              "BSNL",
        "circle":               "Punjab",
        "account_age_days":     900,
        "sim_swap_count_90d":   0,
    },
}

DEFAULT_PROFILE = {
    "sim_swapped_recently": False,
    "days_since_sim_swap":  180,
    "roaming":              False,
    "network_risk_score":   0.10,
    "risk_factors":         [],
    "carrier":              "Unknown",
    "circle":               "Unknown",
    "account_age_days":     365,
    "sim_swap_count_90d":   0,
}


class CAMARACheckRequest(BaseModel):
    user_hash:  str
    session_id: str = ""
    msisdn:     str = ""        # optional phone number (not used in mock)


class CAMARASmsRequest(BaseModel):
    to:     str                 # recipient MSISDN (E.164 or national format)
    body:   str
    reason: str = ""            # the fraud reason that triggered the notification


# In-memory outbound SMS log (the mock has no real carrier). Each entry mirrors
# what a real SMSC gateway would echo back: a message id + the accepted payload.
# The admin panel's notify-on-block flow routes customer SMS through here so the
# demo shows the exact message a real carrier would deliver.
OUTBOUND_SMS: list[dict] = []


@app.get("/health")
def health():
    return {"status": "ok", "service": "Citadel CAMARA Mock"}


@app.post("/mock/check")
def camara_check(req: CAMARACheckRequest):
    profile = NETWORK_PROFILES.get(req.user_hash, DEFAULT_PROFILE)

    response = {
        "user_hash":            req.user_hash,
        "checked_at":           datetime.now(timezone.utc).isoformat(),
        **profile,
        # Derived risk level for Pathway 2 enrichment
        "camara_risk_level":    _risk_level(profile["network_risk_score"]),
        "recommended_action":   _action(profile),
    }

    logger.info(
        "CAMARA check: user=%s risk=%.2f factors=%s",
        req.user_hash[:12], profile["network_risk_score"], profile["risk_factors"],
    )
    return response


@app.get("/mock/profile/{user_hash}")
def get_profile(user_hash: str):
    """Seed or inspect a user's network profile (debug endpoint)."""
    return NETWORK_PROFILES.get(user_hash, DEFAULT_PROFILE)


@app.post("/mock/sms")
def camara_sms(req: CAMARASmsRequest):
    """Accept an outbound SMS for delivery (mock SMSC gateway).

    Citadel's admin notify-on-block flow routes customer SMS through the
    CAMARA telecom API. A real deployment hands this to the carrier's SMS gateway;
    the mock records the message and echoes a gateway-style message id so the
    backend can log a faithful "sent" row. No real carrier is involved.
    """
    import uuid as _uuid
    msg_id = f"MOCK-{_uuid.uuid4().hex[:12].upper()}"
    entry = {
        "message_id": msg_id,
        "to": req.to,
        "body": req.body,
        "reason": req.reason,
        "accepted_at": datetime.now(timezone.utc).isoformat(),
        "status": "ACCEPTED",
    }
    OUTBOUND_SMS.append(entry)
    logger.info("CAMARA SMS: to=%s reason=%s msg_id=%s", req.to, req.reason, msg_id)
    return {"status": "accepted", "message_id": msg_id, "segments": 1, "encoding": "GSM-7"}


@app.get("/mock/sms/outbox")
def sms_outbox():
    """Inspect the mock's outbound SMS log (debug/demo — shows what would have been delivered)."""
    return {"count": len(OUTBOUND_SMS), "messages": list(reversed(OUTBOUND_SMS))}


@app.post("/mock/seed")
def seed_profile(user_hash: str, profile: dict):
    """Dynamically seed a network profile (for testing).

    This overwrites the risk profile that drives Pathway 2 scoring, so it is
    locked to development builds — an attacker seeding
    {"sim_swapped_recently": false, "network_risk_score": 0.0} for their own
    user_hash would otherwise neutralize the SIM-swap signal.
    """
    if os.environ.get("APP_ENV", "development") != "development":
        raise HTTPException(status_code=403, detail="Seeding disabled outside development")
    NETWORK_PROFILES[user_hash] = profile
    return {"seeded": user_hash}


def _risk_level(score: float) -> str:
    if score >= 0.7:
        return "HIGH"
    if score >= 0.4:
        return "MEDIUM"
    return "LOW"


def _action(profile: dict) -> str:
    factors = profile.get("risk_factors", [])
    if "SIM_SWAP_LAST_24H" in factors:
        return "BLOCK — SIM swapped in last 24h, high fraud probability"
    if "MSISDN_PORT_DETECTED" in factors:
        return "STEP_UP — Mobile number ported recently, verify identity"
    if profile.get("roaming"):
        return "STEP_UP — Transaction from roaming SIM, verify via OTP"
    return "ALLOW — Network signals within normal parameters"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
