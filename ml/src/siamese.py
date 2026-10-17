"""
Siamese Network for 3-shot behavioral enrollment.
Triplet-loss architecture compares BehaveFormer embeddings.
Day-1 cold-start: enroll on 3 sessions, then compare incoming sessions.
"""
from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))


class SiameseHead(nn.Module):
    """
    Projection head for metric learning.
    Maps 128-dim embedding → 64-dim space for cosine comparison.
    """

    def __init__(self, embed_dim: int = 128, proj_dim: int = 64) -> None:
        super().__init__()
        self.proj = nn.Sequential(
            nn.Linear(embed_dim, proj_dim),
            nn.GELU(),
            nn.LayerNorm(proj_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out  = self.proj(x)
        norm = out.norm(dim=-1, keepdim=True).clamp(min=1e-8)
        return out / norm


class SiameseNetwork:
    """
    Inference-only Siamese comparator.
    Uses cosine similarity in the projected space.
    """

    def __init__(self, embed_dim: int = 128) -> None:
        self.head = SiameseHead(embed_dim)
        self.head.eval()
        model_path = MODEL_DIR / "siamese_head.pth"
        if model_path.exists():
            self.head.load_state_dict(torch.load(model_path, map_location="cpu"))
            logger.info("Loaded Siamese head weights from %s", model_path)
        else:
            logger.warning("Siamese: random init — no weights at %s", model_path)

    def similarity(self, emb_a: np.ndarray, emb_b: np.ndarray) -> float:
        """Returns cosine similarity 0-1 between two BehaveFormer embeddings."""
        with torch.no_grad():
            a = torch.tensor(emb_a, dtype=torch.float32).unsqueeze(0)
            b = torch.tensor(emb_b, dtype=torch.float32).unsqueeze(0)
            pa = self.head(a)
            pb = self.head(b)
            sim = (pa * pb).sum(dim=-1).item()
        return float((sim + 1.0) / 2.0)   # rescale cosine [-1,1] → [0,1]


class EnrollmentTracker:
    """
    3-shot enrollment tracker with disk persistence.

    Stores per-user embeddings and computes the mean passport embedding once
    MIN_SESSIONS sessions are enrolled. Passports are persisted to a JSON file
    on the bind-mounted volume so they SURVIVE ML-service restarts. (Production
    upgrade: move this store to Redis/Postgres — the interface is the same.)
    """

    MIN_SESSIONS = 3
    MAX_EMBEDDINGS = 20   # cap per-user stored enrollment embeddings (drop oldest)
    STORE_PATH = Path(os.getenv("PASSPORT_STORE", str(MODEL_DIR / "passports.json")))

    def __init__(self) -> None:
        self._store: dict[str, list[np.ndarray]] = defaultdict(list)
        self._load()

    def _load(self) -> None:
        try:
            if self.STORE_PATH.exists():
                raw = json.loads(self.STORE_PATH.read_text())
                self._store = defaultdict(
                    list, {u: [np.asarray(e, dtype=np.float32) for e in embs]
                           for u, embs in raw.items()})
                logger.info("Loaded %d enrolled passports from %s",
                            len(self._store), self.STORE_PATH)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not load passport store (%s) — starting empty", e)

    def _save(self) -> None:
        try:
            self.STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {u: [e.tolist() for e in embs] for u, embs in self._store.items()}
            self.STORE_PATH.write_text(json.dumps(data))
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not persist passport store: %s", e)

    def enroll(self, user_id: str, embedding: np.ndarray) -> int:
        """Add one enrollment embedding, persist, and return current count."""
        embs = self._store[user_id]
        embs.append(embedding.copy())
        # Cap stored embeddings — keep the most-recent MAX_EMBEDDINGS, drop oldest.
        if len(embs) > self.MAX_EMBEDDINGS:
            del embs[: len(embs) - self.MAX_EMBEDDINGS]
        self._save()
        return len(self._store[user_id])

    def is_enrolled(self, user_id: str) -> bool:
        return len(self._store[user_id]) >= self.MIN_SESSIONS

    def passport_embedding(self, user_id: str) -> Optional[np.ndarray]:
        """Returns mean of stored embeddings, or None if not yet enrolled."""
        embs = self._store[user_id]
        if not embs:
            return None
        return np.mean(embs, axis=0).astype(np.float32)

    def session_count(self, user_id: str) -> int:
        return len(self._store[user_id])


class SiameseSimilarityScorer:
    """
    Combines SiameseNetwork + EnrollmentTracker.
    Returns a similarity score 0-1 (1 = identical to passport).
    """

    def __init__(self) -> None:
        self.network  = SiameseNetwork()
        self.tracker  = EnrollmentTracker()

    def score_only(self, user_id: str, embedding: np.ndarray) -> float:
        """
        Compare the session embedding against the existing passport WITHOUT
        mutating the passport or persisting. This is the /score path: a score
        call must never enroll the caller (that would let an attacker enroll as
        a victim and then score as them) and must never rewrite passports.json
        on every request.

        Returns 0.5 (neutral) if the user has no passport yet.
        """
        passport = self.tracker.passport_embedding(user_id)
        if passport is None:
            # First ever login — no baseline yet, return neutral
            return 0.5
        # Compare against the existing passport — DO NOT enroll or persist.
        return self.network.similarity(passport, embedding)

    def enroll_and_score(self, user_id: str, embedding: np.ndarray) -> float:
        """
        Enroll the session embedding (append + cap + persist) and return the
        similarity to the passport computed BEFORE this enrollment. Used by the
        /enroll endpoint. /score must NOT call this — use score_only().
        """
        passport = self.tracker.passport_embedding(user_id)
        # Enroll AFTER reading passport so we compare against previous sessions
        self.tracker.enroll(user_id, embedding)
        if passport is None:
            return 0.5
        return self.network.similarity(passport, embedding)

    def enrollment_status(self, user_id: str) -> dict:
        count     = self.tracker.session_count(user_id)
        enrolled  = self.tracker.is_enrolled(user_id)
        return {
            "sessions_enrolled": count,
            "is_enrolled":       enrolled,
            "sessions_remaining": max(0, self.tracker.MIN_SESSIONS - count),
        }
