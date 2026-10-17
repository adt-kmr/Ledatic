"""Neutral stand-ins for the torch models when torch is not installed (e.g. s390x)."""
from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np

logger = logging.getLogger(__name__)
logger.warning(
    "torch not installed: BehaveFormer / Siamese / CNN-LSTM are DISABLED, "
    "returning neutral values"
)

EMBED_DIM = 128


class _StubModel:
    embed_dim = EMBED_DIM


class BehaveFormerEncoder:
    def __init__(self) -> None:
        self.model = _StubModel()

    def encode(self, ks_seq) -> np.ndarray:
        return np.zeros(EMBED_DIM, dtype=np.float32)


class _StubTracker:
    MIN_SESSIONS = 3

    def __init__(self) -> None:
        self._counts: dict[str, int] = defaultdict(int)

    def enroll(self, user_id: str, embedding) -> int:
        self._counts[user_id] += 1
        return self._counts[user_id]

    def session_count(self, user_id: str) -> int:
        return self._counts[user_id]

    def is_enrolled(self, user_id: str) -> bool:
        return self._counts[user_id] >= self.MIN_SESSIONS


class SiameseSimilarityScorer:
    def __init__(self) -> None:
        self.tracker = _StubTracker()

    def score_only(self, user_id: str, embedding) -> float:
        return 0.5

    def enroll_and_score(self, user_id: str, embedding) -> float:
        self.tracker.enroll(user_id, embedding)
        return 0.5

    def enrollment_status(self, user_id: str) -> dict:
        count = self.tracker.session_count(user_id)
        return {
            "enrolled": count >= self.tracker.MIN_SESSIONS,
            "sessions_enrolled": count,
            "sessions_remaining": max(0, self.tracker.MIN_SESSIONS - count),
        }


class SessionDriftDetector:
    def score(self, mouse_seq) -> float:
        return 0.0
