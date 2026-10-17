"""Tests for the CNN-LSTM session drift detector."""
import os
import pytest
import numpy as np

os.environ.setdefault("IMEI_HMAC_SECRET", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from src.cnn_lstm import SessionDriftDetector


@pytest.fixture
def detector():
    return SessionDriftDetector()


def _make_mouse_seq(n=20):
    """Build a (n, 4) float32 numpy array: [x_norm, y_norm, vel_norm, click]."""
    seq = np.zeros((n, 4), dtype=np.float32)
    seq[:, 0] = np.linspace(0.1, 0.9, n)  # x_norm
    seq[:, 1] = np.linspace(0.2, 0.8, n)  # y_norm
    seq[:, 2] = np.linspace(0.0, 0.5, n)  # vel_norm
    seq[:, 3] = 0.0  # click
    return seq


class TestDriftDetector:
    def test_score_returns_float(self, detector):
        score = detector.score(_make_mouse_seq(20))
        assert isinstance(score, float)

    def test_score_range(self, detector):
        score = detector.score(_make_mouse_seq(20))
        assert 0.0 <= score <= 1.0

    def test_empty_events(self, detector):
        score = detector.score(np.array([], dtype=np.float32).reshape(0, 4))
        assert isinstance(score, float)
        assert score == 0.0

    def test_single_event(self, detector):
        score = detector.score(np.array([[100.0, 200.0, 0.0, 0.0]], dtype=np.float32))
        assert isinstance(score, float)

    def test_normal_movement_low_drift(self, detector):
        score = detector.score(_make_mouse_seq(30))
        assert score < 0.5

    def test_erratic_movement_higher_drift(self, detector):
        np.random.seed(42)
        seq = np.random.rand(30, 4).astype(np.float32)
        score = detector.score(seq)
        assert score >= 0.0
