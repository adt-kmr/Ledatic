"""Tests for the XGBoost + IsolationForest risk scorer."""
import os
import pytest
import numpy as np

os.environ.setdefault("IMEI_HMAC_SECRET", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from src.risk_scorer import RiskScorer


@pytest.fixture(scope="module")
def scorer():
    s = RiskScorer()
    s.train()
    return s


def _make_features():
    """Build a (40,) float32 feature vector matching FEATURE_DIM layout."""
    f = np.zeros(40, dtype=np.float32)
    f[0] = 95.0   # mean_dwell_time
    f[2] = 145.0  # mean_flight_time
    f[4] = 5.0    # keystroke_rate
    return f


class TestRiskScorer:
    def test_score_returns_tuple(self, scorer):
        features = _make_features()
        risk_score, coercion_prob, shap_features = scorer.score(features, 0.8, 0.1)
        assert isinstance(risk_score, int)
        assert 0 <= risk_score <= 1000
        assert 0.0 <= coercion_prob <= 1.0
        assert isinstance(shap_features, list)

    def test_score_range_bounds(self, scorer):
        features = _make_features()
        for _ in range(10):
            risk_score, _, _ = scorer.score(features, 0.5, 0.1)
            assert 0 <= risk_score <= 1000

    def test_shap_features_have_structure(self, scorer):
        features = _make_features()
        _, _, shap_features = scorer.score(features, 0.5, 0.1)
        assert len(shap_features) <= 5
        for f in shap_features:
            assert "feature" in f
            assert "shap_value" in f
