"""Tests for the BehaveFormer transformer encoder."""
import os
import pytest
import numpy as np

os.environ.setdefault("IMEI_HMAC_SECRET", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from src.behaveformer import BehaveFormerEncoder


@pytest.fixture
def encoder():
    return BehaveFormerEncoder()


class TestBehaveFormer:
    def test_encode_returns_numpy(self, encoder):
        seq = np.random.randn(20, 6).astype(np.float32)
        embedding = encoder.encode(seq)
        assert isinstance(embedding, np.ndarray)

    def test_embedding_dimension(self, encoder):
        seq = np.random.randn(20, 6).astype(np.float32)
        embedding = encoder.encode(seq)
        assert embedding.shape == (encoder.model.embed_dim,)

    def test_empty_sequence_handled(self, encoder):
        seq = np.array([], dtype=np.float32).reshape(0, 6)
        embedding = encoder.encode(seq)
        assert isinstance(embedding, np.ndarray)
        assert embedding.shape[0] == encoder.model.embed_dim

    def test_single_event(self, encoder):
        seq = np.array([[95.0, 145.0, 0.0, 0.0, 0.0, 0.0]], dtype=np.float32)
        embedding = encoder.encode(seq)
        assert isinstance(embedding, np.ndarray)

    def test_deterministic(self, encoder):
        seq = np.random.randn(15, 6).astype(np.float32)
        e1 = encoder.encode(seq)
        e2 = encoder.encode(seq)
        np.testing.assert_array_almost_equal(e1, e2, decimal=5)
