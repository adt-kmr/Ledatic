"""
Unit tests for PQC signer (CRYSTALS-Dilithium-3 / NIST FIPS 204).

Tests:
  1. Sign + verify round-trip passes
  2. Tampered signature fails verification
  3. Wrong public key fails verification
  4. Graceful unavailability when dilithium not installed
  5. Canonical bundle determinism
"""
import pytest
import importlib


# ── Helper: skip if dilithium-py not installed ────────────────────────────────
def _dilithium_available() -> bool:
    try:
        importlib.import_module("dilithium_py.dilithium")
        return True
    except ImportError:
        return False


requires_dilithium = pytest.mark.skipif(
    not _dilithium_available(),
    reason="dilithium-py not installed — install with: pip install dilithium-py"
)


# ── Tests ─────────────────────────────────────────────────────────────────────

@requires_dilithium
def test_sign_and_verify_roundtrip():
    """Signing a bundle and immediately verifying it must return verified=True."""
    from app.services.pqc_signer import PQCSigner

    signer = PQCSigner()
    assert signer.available, "Signer must be available when dilithium-py is installed"

    bundle = {
        "keystroke_events": [{"key": "a", "dwell": 80}, {"key": "b", "dwell": 95}],
        "mouse_events": [{"x": 100, "y": 200, "velocity": 1.2}],
        "environment": {"tab_visible": True},
        "user_id": "test-user-001",
    }

    sig = signer.sign_behavioral_hash(bundle)
    assert sig.pqc_available is True
    assert sig.algorithm == "Dilithium-3"
    assert len(sig.signature_b64) > 100
    assert len(sig.public_key_b64) > 100
    assert len(sig.behavioral_hash) == 64  # SHA3-256 hex = 64 chars
    assert sig.sign_time_ms >= 0

    result = signer.verify_behavioral_hash(bundle, sig.signature_b64, sig.public_key_b64)
    assert result.verified is True, f"Expected PASS, got: {result.reason}"
    assert result.algorithm == "Dilithium-3"
    assert result.pqc_available is True


@requires_dilithium
def test_tampered_signature_fails():
    """A signature with 1 byte flipped must fail verification."""
    import base64
    from app.services.pqc_signer import PQCSigner

    signer = PQCSigner()
    bundle = {"keystroke_events": [{"key": "x", "dwell": 70}], "user_id": "test-002"}

    sig = signer.sign_behavioral_hash(bundle)
    assert sig.pqc_available

    # Flip one byte in the signature
    raw = base64.b64decode(sig.signature_b64)
    tampered = bytearray(raw)
    tampered[42] ^= 0xFF  # flip byte at offset 42
    tampered_b64 = base64.b64encode(bytes(tampered)).decode()

    result = signer.verify_behavioral_hash(bundle, tampered_b64, sig.public_key_b64)
    assert result.verified is False, "Tampered signature should FAIL verification"


@requires_dilithium
def test_wrong_public_key_fails():
    """Verifying with a completely different keypair's public key must fail."""
    from app.services.pqc_signer import PQCSigner

    signer1 = PQCSigner()
    signer2 = PQCSigner()  # fresh keypair

    bundle = {"keystroke_events": [{"key": "z", "dwell": 60}], "user_id": "test-003"}

    sig = signer1.sign_behavioral_hash(bundle)
    # Verify with signer2's public key — must fail
    result = signer1.verify_behavioral_hash(bundle, sig.signature_b64, signer2.public_key_b64)
    assert result.verified is False, "Wrong public key should FAIL verification"


@requires_dilithium
def test_canonical_bundle_determinism():
    """Same logical bundle (different dict order, extra session_id) should produce same hash."""
    from app.services.pqc_signer import _canonical_bundle, _sha3_256

    bundle_a = {
        "user_id": "u1",
        "keystroke_events": [{"key": "a"}],
        "session_id": "session-abc-123",  # volatile — should be stripped
    }
    bundle_b = {
        "session_id": "session-xyz-999",  # different session
        "keystroke_events": [{"key": "a"}],
        "user_id": "u1",
    }

    hash_a = _sha3_256(_canonical_bundle(bundle_a))
    hash_b = _sha3_256(_canonical_bundle(bundle_b))
    assert hash_a == hash_b, "Canonical hash should be the same regardless of session_id / key order"


def test_unavailability_degrades_gracefully(monkeypatch):
    """When dilithium_py import fails, PQCSigner returns pqc_available=False stubs."""
    import app.services.pqc_signer as pqc_mod

    # Monkeypatch the availability flag
    original = pqc_mod._DILITHIUM_AVAILABLE
    pqc_mod._DILITHIUM_AVAILABLE = False

    try:
        signer = pqc_mod.PQCSigner()
        assert signer.available is False

        bundle = {"keystroke_events": [], "user_id": "test"}
        sig = signer.sign_behavioral_hash(bundle)
        assert sig.pqc_available is False
        assert sig.signature_b64 == ""

        verify = signer.verify_behavioral_hash(bundle, "", "")
        assert verify.verified is False
        assert verify.pqc_available is False
    finally:
        pqc_mod._DILITHIUM_AVAILABLE = original


@requires_dilithium
def test_get_status_structure():
    """get_status() must return a well-formed dict for the admin UI."""
    from app.services.pqc_signer import PQCSigner

    signer = PQCSigner()
    status = signer.get_status()

    assert "pqc_available" in status
    assert "algorithm" in status
    assert "standard" in status
    assert "security_level" in status
    assert "library" in status
    assert status["pqc_available"] is True
    assert status["algorithm"] == "Dilithium-3"
    assert "FIPS 204" in status["standard"]
