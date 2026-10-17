"""Tests for the Siamese 3-shot enrollment and similarity scoring."""
import os
import pytest
import numpy as np

os.environ.setdefault("IMEI_HMAC_SECRET", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from src.siamese import SiameseSimilarityScorer


@pytest.fixture
def siamese():
    return SiameseSimilarityScorer()


class TestSiameseEnrollment:
    def test_enrollment_status_unenrolled(self, siamese):
        status = siamese.enrollment_status("new-user-001")
        assert status["is_enrolled"] is False
        assert status["sessions_remaining"] > 0

    def test_enroll_increments_count(self, siamese):
        user_id = "enroll-test-user"
        embedding = np.random.randn(128).astype(np.float32)
        count = siamese.tracker.enroll(user_id, embedding)
        assert count >= 1

    def test_enrollment_completes_at_min_sessions(self, siamese):
        user_id = "enroll-complete-user"
        for _ in range(siamese.tracker.MIN_SESSIONS + 1):
            embedding = np.random.randn(128).astype(np.float32)
            siamese.tracker.enroll(user_id, embedding)
        status = siamese.enrollment_status(user_id)
        assert status["is_enrolled"] is True

    def test_score_only_returns_float(self, siamese):
        embedding = np.random.randn(128).astype(np.float32)
        score = siamese.score_only("unknown-user", embedding)
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    def test_similar_embeddings_high_score(self, siamese):
        user_id = "sim-test-user"
        base = np.random.randn(128).astype(np.float32)
        for _ in range(siamese.tracker.MIN_SESSIONS + 1):
            siamese.tracker.enroll(user_id, base + np.random.randn(128).astype(np.float32) * 0.01)
        score = siamese.score_only(user_id, base)
        assert score > 0.5

    def test_different_embeddings_low_score(self, siamese):
        user_id = "diff-test-user"
        base = np.random.randn(128).astype(np.float32)
        for _ in range(siamese.tracker.MIN_SESSIONS + 1):
            siamese.tracker.enroll(user_id, base)
        different = np.random.randn(128).astype(np.float32) * 10
        score = siamese.score_only(user_id, different)
        assert score < 0.8
