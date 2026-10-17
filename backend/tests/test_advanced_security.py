"""
Tests for the four advanced-cybersecurity modules:
  Phase 1  Active Deception          (deception service, Redis-down fallback)
  Phase 2  Anti-Spoofing             (replay nonce + HMAC, micro-tremor FFT)
  Phase 3  Post-Quantum KEM          (ML-KEM-768 keygen/encaps/decaps)
  Phase 4  zk-SNARK passport verify  (Groth16 over BN254)

These exercise the pure/service layer directly (no HTTP), so they run without a
live Postgres/Redis. Crypto-dependent tests skip gracefully if the optional
library is not installed in the current environment.
"""
import json
import os

import pytest

from app.services import anti_spoofing, deception, nonce_store


# ── Phase 1: Active Deception ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_deception_trap_blacklists_and_broadcasts(monkeypatch):
    # Force the Redis-down path (what Render uses) to test the local fallback.
    monkeypatch.setattr(deception, "get_redis", lambda: None)
    ip = "198.51.100.5"
    assert await deception.is_blacklisted(ip) is False

    q = deception.get_broadcaster().subscribe()
    event = await deception.trigger_trap("DOM_HONEYPOT", ip, "honeypot filled", session_id="s1")
    assert event.kind == "DOM_HONEYPOT"
    assert await deception.is_blacklisted(ip) is True

    broadcast = q.get_nowait()
    assert broadcast["risk_score"] == 1000 and broadcast["kind"] == "DOM_HONEYPOT"
    deception.get_broadcaster().unsubscribe(q)


# ── Phase 2: Anti-Spoofing ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_replay_nonce_single_use(monkeypatch):
    monkeypatch.setattr(nonce_store, "get_redis", lambda: None)
    issued = await nonce_store.issue()
    nonce, key = issued["nonce"], issued["session_key"]
    digest = anti_spoofing.bundle_hash({"a": 1, "b": [2, 3]})
    sig = anti_spoofing.expected_signature(key, nonce, digest)

    consumed = await nonce_store.consume(nonce)
    assert consumed == key
    assert anti_spoofing.validate_telemetry_signature(consumed, nonce, digest, sig) is True
    # Replay of the same nonce must be rejected (single-use).
    assert await nonce_store.consume(nonce) is None
    # Tampered signature fails.
    assert anti_spoofing.validate_telemetry_signature(key, nonce, digest, "00") is False


def test_micro_tremor_neutral_on_insufficient_or_subnyquist():
    # Too few samples → NEUTRAL (never falsely flags a human as a bot).
    assert anti_spoofing.verify_micro_tremor_fft([1.0] * 8)["is_human"] is None
    # Sub-Nyquist sampling → NEUTRAL rather than a spurious ratio.
    ts = [i * 100.0 for i in range(40)]  # 10 Hz sampling, < 2*12Hz
    res = anti_spoofing.verify_micro_tremor_fft([float(i % 3) for i in range(40)], ts)
    assert res["is_human"] is None and res["reason"] == "SUBNYQUIST_RATE"


def test_micro_tremor_separates_smooth_from_jittery():
    import numpy as np
    t = np.linspace(0, 1, 200)
    smooth = np.sin(2 * np.pi * 1.5 * t)  # pure low-freq spline (bot)
    jittery = smooth + 0.15 * np.sin(2 * np.pi * 10 * t)  # + 10 Hz tremor (human)
    ts = (t * 1000).tolist()
    r_bot = anti_spoofing.verify_micro_tremor_fft(smooth.tolist(), ts)
    r_human = anti_spoofing.verify_micro_tremor_fft(jittery.tolist(), ts)
    assert r_human["tremor_ratio"] > r_bot["tremor_ratio"]


# ── Phase 3: Post-Quantum KEM ──────────────────────────────────────────────────

def test_pqc_kem_roundtrip():
    from app.services.pqc_kem import get_pqc_kem
    kem = get_pqc_kem()
    if not kem.available:
        pytest.skip("kyber-py not installed")
    st = kem.selftest()
    assert st["ok"] is True
    assert st["encaps_key_bytes"] == 1184 and st["ciphertext_bytes"] == 1088

    # Full handshake: encapsulate to the server key, server decapsulates + confirms.
    import base64
    from kyber_py.ml_kem import ML_KEM_768
    ek = base64.b64decode(kem.public_key_b64)
    _shared, ct = ML_KEM_768.encaps(ek)
    res = kem.decapsulate(base64.b64encode(ct).decode())
    assert res.ok and res.confirm_b64
    # Garbage ciphertext is rejected, not crashed.
    assert kem.decapsulate("bm90LWEtY2lwaGVydGV4dA==").ok is False


# ── Phase 4: zk-SNARK passport ─────────────────────────────────────────────────

def test_zkp_verifier_accepts_valid_rejects_tampered():
    from app.services.zkp_verifier import get_zkp_verifier
    v = get_zkp_verifier()
    if not v.available:
        pytest.skip("py_ecc not installed or vkey missing")
    fixture = os.path.join(os.path.dirname(__file__), "zk_sample_proof.json")
    if not os.path.exists(fixture):
        pytest.skip("zk sample proof fixture missing")
    sp = json.load(open(fixture))
    assert v.verify(sp["proof"], sp["publicSignals"]) is True
    # Tampering any public signal invalidates the proof.
    bad = list(sp["publicSignals"])
    bad[0] = str(int(bad[0]) + 1)
    assert v.verify(sp["proof"], bad) is False
