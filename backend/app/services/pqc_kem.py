"""
Citadel — Post-Quantum Key Encapsulation (ML-KEM-768 / Kyber)
=================================================================

Companion to pqc_signer.py (which does ML-DSA / Dilithium *signatures*). This
module does ML-KEM-768 (NIST FIPS 203) *key encapsulation* — establishing a
post-quantum shared secret for the telemetry channel so that "harvest-now,
decrypt-later" adversaries cannot recover it even with a future quantum computer.

Handshake (client ⇄ server):
  1. Server publishes its ML-KEM-768 encapsulation key (ek).
  2. Client runs encaps(ek) → (shared_secret, ciphertext); keeps the secret,
     sends the ciphertext.
  3. Server decaps(dk, ciphertext) → the same shared_secret.
  4. Server returns confirm = HMAC(shared_secret, DOMAIN); the client recomputes
     it from its own copy of the secret. Matching confirms mutual agreement — a
     working post-quantum key exchange — without ever transmitting the secret.

Library: kyber-py (pure Python, same author as the dilithium-py already shipped,
no native liboqs → builds cleanly on Render). Graceful degradation: if kyber-py
is missing, available=False and every method is a safe no-op; the rest of the app
(and the Dilithium signing) keeps working.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

KEM_ALGORITHM = "ML-KEM-768"
_CONFIRM_DOMAIN = b"citadel-pqc-kem-confirm-v1"

# ── Optional import ───────────────────────────────────────────────────────────
try:
    from kyber_py.ml_kem import ML_KEM_768  # type: ignore
    _KEM_OK = True
    logger.info("✅ kyber-py loaded — ML-KEM-768 (NIST FIPS 203) key encapsulation active")
except Exception:  # noqa: BLE001
    ML_KEM_768 = None  # type: ignore
    _KEM_OK = False
    logger.warning("⚠️  kyber-py not installed — PQC KEM disabled (pip install kyber-py)")


@dataclass
class KemHandshakeResult:
    ok: bool
    algorithm: str
    confirm_b64: Optional[str] = None
    shared_secret: Optional[bytes] = None
    reason: Optional[str] = None


def _confirm(shared_secret: bytes) -> str:
    return base64.b64encode(hmac.new(shared_secret, _CONFIRM_DOMAIN, hashlib.sha256).digest()).decode()


class PQCKem:
    """Server-held ML-KEM-768 keypair + decapsulation."""

    def __init__(self) -> None:
        self.available = _KEM_OK
        self._ek: Optional[bytes] = None
        self._dk: Optional[bytes] = None
        if self.available:
            try:
                self._ek, self._dk = ML_KEM_768.keygen()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ML-KEM keygen failed, disabling KEM: %s", exc)
                self.available = False

    @property
    def public_key_b64(self) -> Optional[str]:
        return base64.b64encode(self._ek).decode() if self._ek else None

    def decapsulate(self, ciphertext_b64: str) -> KemHandshakeResult:
        """Decapsulate a client ciphertext into the shared secret + confirm tag."""
        if not self.available or self._dk is None:
            return KemHandshakeResult(False, KEM_ALGORITHM, reason="KEM_UNAVAILABLE")
        try:
            ct = base64.b64decode(ciphertext_b64)
        except Exception:  # noqa: BLE001
            return KemHandshakeResult(False, KEM_ALGORITHM, reason="BAD_CIPHERTEXT_B64")
        try:
            shared = ML_KEM_768.decaps(self._dk, ct)
        except Exception as exc:  # noqa: BLE001
            return KemHandshakeResult(False, KEM_ALGORITHM, reason=f"DECAPS_FAILED:{type(exc).__name__}")
        if not shared or len(shared) != 32:
            return KemHandshakeResult(False, KEM_ALGORITHM, reason="BAD_SHARED_LEN")
        return KemHandshakeResult(True, KEM_ALGORITHM, confirm_b64=_confirm(shared), shared_secret=shared)

    def selftest(self) -> dict:
        """Full keygen→encaps→decaps round trip, proving the KEM works end-to-end
        (useful for a demo even when no browser client is present)."""
        if not self.available:
            return {"ok": False, "algorithm": KEM_ALGORITHM, "reason": "KEM_UNAVAILABLE"}
        ek, dk = ML_KEM_768.keygen()
        shared_a, ct = ML_KEM_768.encaps(ek)
        shared_b = ML_KEM_768.decaps(dk, ct)
        return {
            "ok": shared_a == shared_b,
            "algorithm": KEM_ALGORITHM,
            "encaps_key_bytes": len(ek),
            "ciphertext_bytes": len(ct),
            "shared_secret_bytes": len(shared_a),
        }


# ── Module singleton ──────────────────────────────────────────────────────────
_kem: Optional[PQCKem] = None


def get_pqc_kem() -> PQCKem:
    global _kem
    if _kem is None:
        _kem = PQCKem()
    return _kem


def init_pqc_kem() -> None:
    """Eagerly build the server keypair at startup (non-fatal)."""
    get_pqc_kem()
