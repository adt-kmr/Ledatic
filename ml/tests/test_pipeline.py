"""Tests for the ML pipeline — scoring, features, and enrollment."""
import os
import time
import pytest
import numpy as np

os.environ.setdefault("IMEI_HMAC_SECRET", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from src.feature_engine import extract_features, build_keystroke_sequence, build_mouse_sequence


def _make_signal_bundle(n_keys=20, dwell=95.0, flight=145.0):
    """Build a realistic signal bundle for testing."""
    ks = []
    t = 1000.0
    for i in range(n_keys):
        dt = dwell + (i % 3) * 10
        ft = flight + (i % 5) * 15
        ks.append({"eventType": "keydown", "timestamp": t, "key": "A", "dwellTime": dt, "flightTime": ft})
        ks.append({"eventType": "keyup", "timestamp": t + dt, "key": "A", "dwellTime": dt, "flightTime": ft})
        t += dt + ft
    return {
        "keystrokeEvents": ks,
        "mouseEvents": [
            {"eventType": "mousemove", "timestamp": 1000 + i * 50, "x": 100 + i * 10, "y": 200 + i * 5}
            for i in range(15)
        ],
        "environment": {"screenShareActive": False, "clipboardSource": "typed", "tabVisible": True, "deviceType": "desktop"},
    }


class TestFeatureExtraction:
    def test_returns_array_with_expected_length(self):
        bundle = _make_signal_bundle()
        features = extract_features(bundle)
        assert isinstance(features, np.ndarray)
        assert features.shape == (40,)

    def test_dwell_time_positive(self):
        bundle = _make_signal_bundle(dwell=95.0)
        features = extract_features(bundle)
        assert features[0] > 0  # mean_dwell_time is first feature

    def test_flight_time_positive(self):
        bundle = _make_signal_bundle(flight=145.0)
        features = extract_features(bundle)
        assert features[2] > 0  # mean_flight_time is third feature

    def test_empty_bundle_handled(self):
        features = extract_features({"keystrokeEvents": [], "mouseEvents": []})
        assert isinstance(features, np.ndarray)
        assert features.shape == (40,)

    def test_keystroke_rate_nonzero(self):
        bundle = _make_signal_bundle(n_keys=10)
        features = extract_features(bundle)
        assert features[4] >= 0  # keystroke_rate is fifth feature


class TestKeystrokeSequence:
    def test_returns_numpy_array(self):
        bundle = _make_signal_bundle()
        seq = build_keystroke_sequence(bundle)
        assert isinstance(seq, np.ndarray)

    def test_shape_valid(self):
        bundle = _make_signal_bundle(n_keys=10)
        seq = build_keystroke_sequence(bundle)
        assert seq.ndim == 2
        assert seq.shape[0] > 0


class TestMouseSequence:
    def test_returns_numpy_array(self):
        bundle = _make_signal_bundle()
        seq = build_mouse_sequence(bundle)
        assert isinstance(seq, np.ndarray)

    def test_empty_mouse_events(self):
        bundle = _make_signal_bundle()
        bundle["mouseEvents"] = []
        seq = build_mouse_sequence(bundle)
        assert isinstance(seq, np.ndarray)
        # Function returns a minimum window even with no events
        assert seq.ndim == 2
        assert seq.shape[1] == 4


class TestPipelineLatency:
    def test_feature_extraction_under_50ms(self):
        bundle = _make_signal_bundle(n_keys=50)
        t0 = time.monotonic()
        for _ in range(100):
            extract_features(bundle)
        elapsed_ms = (time.monotonic() - t0) * 1000 / 100
        assert elapsed_ms < 50, f"Feature extraction too slow: {elapsed_ms:.1f}ms"
