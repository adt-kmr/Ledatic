from contextlib import asynccontextmanager
from typing import Any

import logging
import os
import time
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.pipeline import get_pipeline, init_pipeline
from src.transaction_fraud import get_txn_scorer, init_txn_scorer

logger = logging.getLogger("ml_service")
logging.basicConfig(level=logging.INFO)

# ── Internal auth token ─────────────────────────────────────────────────────
# Token resolution (matches backend logic):
#   1. Explicit INTERNAL_API_TOKEN env var (if non-empty)
#   2. HMAC-SHA256 derivation from JWT_SECRET — both services compute the
#      same value independently, no env-var sync needed on Render.
import hmac as _hmac
import hashlib as _hashlib

def _resolve_internal_token() -> str:
    explicit = os.getenv("INTERNAL_API_TOKEN", "")
    if explicit:
        return explicit
    jwt_secret = os.getenv("JWT_SECRET", "")
    if jwt_secret:
        return _hmac.new(
            jwt_secret.encode(),
            b"citadel-internal-api-token",
            _hashlib.sha256,
        ).hexdigest()
    return ""

INTERNAL_API_TOKEN = _resolve_internal_token()


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """FastAPI dependency: enforce a shared internal token on sensitive routes.

    If INTERNAL_API_TOKEN is unset/empty (dev), allow through and log a warning.
    If set, return 401 on any mismatch or missing header.
    """
    if not INTERNAL_API_TOKEN:
        logger.warning(
            "INTERNAL_API_TOKEN not set — /score and friends are unauthenticated. "
            "Set INTERNAL_API_TOKEN in production."
        )
        return
    if x_internal_token is None or x_internal_token != INTERNAL_API_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing X-Internal-Token",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pipeline()
    init_txn_scorer()
    yield


app = FastAPI(
    title="Citadel ML Service",
    version="4.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ───────────────────────────────────────────────────────────────────

# Maximum keystroke/mouse/touch events processed per type to prevent DoS via
# huge signal bundles. Truncation keeps the most recent events and is logged.
MAX_EVENTS_PER_TYPE = 5000


class ScoreRequest(BaseModel):
    session_id:    str
    user_id:       str
    signal_bundle: dict[str, Any]


class ScoreResponse(BaseModel):
    session_id:            str
    risk_score:            int
    embedding:             list[float]
    siamese_similarity:    float
    session_drift:         float
    coercion_probability:  float
    shap_features:         list[dict]
    enrollment_status:     dict
    latency_ms:            int
    status:                str = "scored"   # "capturing" until enough keystrokes
    keystrokes_captured:   int | None = None


class EnrollRequest(BaseModel):
    user_id:       str
    signal_bundle: dict[str, Any]


class TransactionRequest(BaseModel):
    transaction: dict[str, Any]


class TransactionBatchRequest(BaseModel):
    transactions: list[dict[str, Any]]


def _truncate_events(signal_bundle: dict[str, Any]) -> dict[str, Any]:
    """Cap the number of keystroke/mouse/touch events to MAX_EVENTS_PER_TYPE.

    Keeps the most recent events (by list order — clients append, so the tail is
    newest). Mutates a shallow copy so the original request body is untouched.
    Notes any truncation in the logs for DoS debugging.
    """
    keys = [
        ("keystroke_events", "keystrokeEvents"),
        ("mouse_events", "mouseEvents"),
        ("touch_events", "touchEvents"),
    ]
    bundle = dict(signal_bundle)
    for snake, camel in keys:
        events = bundle.get(snake) or bundle.get(camel)
        if not isinstance(events, list):
            continue
        if len(events) > MAX_EVENTS_PER_TYPE:
            logger.warning(
                "Truncating %s from %d to %d events (MAX_EVENTS_PER_TYPE=%d)",
                camel or snake, len(events), MAX_EVENTS_PER_TYPE, MAX_EVENTS_PER_TYPE,
            )
            kept = events[-MAX_EVENTS_PER_TYPE:]
            # write back under whichever key was originally present
            if bundle.get(snake) is not None:
                bundle[snake] = kept
            else:
                bundle[camel] = kept
    return bundle


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/score", response_model=ScoreResponse)
async def score(request: ScoreRequest, _: None = Depends(require_internal_token)):
    pipeline = get_pipeline()
    if pipeline is None or not pipeline.is_ready:
        raise HTTPException(status_code=503, detail="ML pipeline not ready")

    signal_bundle = _truncate_events(request.signal_bundle)
    result = pipeline.score(
        session_id=request.session_id,
        user_id=request.user_id,
        signal_bundle=signal_bundle,
    )
    return ScoreResponse(**result)


@app.post("/enroll")
async def enroll(request: EnrollRequest, _: None = Depends(require_internal_token)):
    """3-shot enrollment endpoint — call 3 times to build behavioral passport."""
    pipeline = get_pipeline()
    if pipeline is None or not pipeline.is_ready:
        raise HTTPException(status_code=503, detail="ML pipeline not ready")

    signal_bundle = _truncate_events(request.signal_bundle)
    return pipeline.enroll(request.user_id, signal_bundle)


@app.post("/score-transaction")
async def score_transaction(
    request: TransactionRequest,
    _: None = Depends(require_internal_token),
):
    """Score a single UPI/bank transaction with XGBoost + COPOD (Pipeline C)."""
    scorer = get_txn_scorer()
    if scorer is None or not scorer.ready:
        raise HTTPException(status_code=503, detail="Transaction fraud models not loaded")
    return scorer.score(request.transaction)


@app.post("/score-transactions")
async def score_transactions(
    request: TransactionBatchRequest,
    _: None = Depends(require_internal_token),
):
    """Batch fraud scoring with peer ranking — the reliable decision path."""
    scorer = get_txn_scorer()
    if scorer is None or not scorer.ready:
        raise HTTPException(status_code=503, detail="Transaction fraud models not loaded")
    return scorer.score_batch(request.transactions)


@app.get("/health")
async def health():
    pipeline  = get_pipeline()
    scorer    = get_txn_scorer()
    return {
        "status":   "ok",
        "service":  "Citadel ML",
        "ml_ready": pipeline is not None and pipeline.is_ready,
        "txn_fraud_ready": scorer is not None and scorer.ready,
    }
