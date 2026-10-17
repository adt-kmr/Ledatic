"""
ML Pipeline orchestrator.
Runs all 4 stages and returns a 0-1000 risk score in <150ms.

Stage 1: Feature extraction         (~1ms)
Stage 2: BehaveFormer embedding     (~5ms)
Stage 3: Siamese similarity         (~1ms)
Stage 4: CNN-LSTM session drift     (~5ms)
Stage 5: XGBoost + IsoForest score  (~2ms)
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import numpy as np

from .behaveformer import BehaveFormerEncoder
from .cnn_lstm import SessionDriftDetector
from .feature_engine import build_keystroke_sequence, build_mouse_sequence, extract_features
from .risk_scorer import RiskScorer
from .siamese import SiameseSimilarityScorer

logger = logging.getLogger(__name__)


class MLPipeline:
    """
    Singleton ML pipeline.  Initialised once at FastAPI startup via init().
    All inference runs on CPU — no GPU needed.
    """

    def __init__(self) -> None:
        self.behaveformer  = BehaveFormerEncoder()
        self.siamese       = SiameseSimilarityScorer()
        self.drift_detector = SessionDriftDetector()
        self.risk_scorer   = RiskScorer()
        self._ready        = False

    def init(self) -> None:
        """Load (or train+persist) the XGBoost + IsoForest risk scorer. Call once from lifespan."""
        logger.info("ML pipeline initialising — loading/training risk scorer...")
        self.risk_scorer.train()
        self._ready = True
        logger.info("ML pipeline ready")

    # ── Inference ─────────────────────────────────────────────────────

    def score(
        self,
        session_id:  str,
        user_id:     str,
        signal_bundle: dict[str, Any],
    ) -> dict[str, Any]:
        t0 = time.monotonic()

        # Guard — behavioral auth needs typing. Before the user has typed enough
        # (e.g. just moved the mouse on the login page), there is no keystroke
        # signal to judge, so we must NOT flag the session as fraud. Return a
        # low neutral score until a minimum number of keystrokes are captured.
        ks_events = signal_bundle.get("keystrokeEvents") or signal_bundle.get("keystroke_events") or []
        n_keydowns = sum(1 for e in ks_events if e.get("eventType") == "keydown")
        MIN_KEYS = 5
        if n_keydowns < MIN_KEYS:
            # Pre-login: minimal typing to judge, driven by low baseline + mouse drift
            mouse_seq = build_mouse_sequence(signal_bundle)
            drift = self.drift_detector.score(mouse_seq)
            pre_login_risk = int(min(15 + drift * 35, 65))   # 15–65, stays clean APPROVE
            return {
                "session_id":          session_id,
                "user_id":             user_id,
                "risk_score":          pre_login_risk,
                "embedding":           [0.0] * self.behaveformer.model.embed_dim,
                "siamese_similarity":  0.5,
                "session_drift":       round(drift, 4),
                "coercion_probability": 0.0,
                "shap_features":       [],
                "enrollment_status":   self.siamese.enrollment_status(user_id),
                "status":              "capturing",   # not enough keystrokes yet
                "keystrokes_captured": n_keydowns,
                "latency_ms":          int((time.monotonic() - t0) * 1000),
            }

        # Stage 1 — Feature extraction
        features = extract_features(signal_bundle)

        # Stage 2 — BehaveFormer 128-dim embedding
        ks_seq  = build_keystroke_sequence(signal_bundle)
        embedding = self.behaveformer.encode(ks_seq)

        # Stage 3 — Siamese similarity to behavioral passport
        # Comparison only — /score must NOT mutate the passport (security: an
        # attacker could otherwise enroll as a victim and then score as them).
        siamese_similarity = self.siamese.score_only(user_id, embedding)
        enrollment_status  = self.siamese.enrollment_status(user_id)

        # Stage 4 — CNN-LSTM session drift score
        mouse_seq   = build_mouse_sequence(signal_bundle)
        session_drift = self.drift_detector.score(mouse_seq)

        # Stage 5 — XGBoost + IsoForest composite score
        risk_score, coercion_prob, shap_top5 = self.risk_scorer.score(
            features, siamese_similarity, session_drift
        )

        latency_ms = int((time.monotonic() - t0) * 1000)

        return {
            "session_id":          session_id,
            "user_id":             user_id,
            "risk_score":          risk_score,
            "embedding":           embedding.tolist(),
            "siamese_similarity":  round(siamese_similarity, 4),
            "session_drift":       round(session_drift, 4),
            "coercion_probability": round(coercion_prob, 4),
            "shap_features":       shap_top5,
            "enrollment_status":   enrollment_status,
            "latency_ms":          latency_ms,
        }

    def enroll(self, user_id: str, signal_bundle: dict[str, Any]) -> dict[str, Any]:
        """Force-enroll a session (used during 3-shot enrollment flow)."""
        ks_seq    = build_keystroke_sequence(signal_bundle)
        embedding = self.behaveformer.encode(ks_seq)
        count     = self.siamese.tracker.enroll(user_id, embedding)
        return {
            "user_id":             user_id,
            "sessions_enrolled":   count,
            "enrollment_complete": count >= self.siamese.tracker.MIN_SESSIONS,
        }

    @property
    def is_ready(self) -> bool:
        return self._ready


# Module-level singleton
_pipeline: MLPipeline | None = None


def get_pipeline() -> MLPipeline | None:
    return _pipeline


def init_pipeline() -> None:
    global _pipeline
    _pipeline = MLPipeline()
    _pipeline.init()
