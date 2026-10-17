"""
Citadel — zk-SNARK Biometric Passport verifier (Groth16 / BN254)
====================================================================

Server-side verification of the `behavioral_passport` Groth16 proof. The client
proves, in zero knowledge, that:
  1. it knows (featureCommit, imeiSecret) whose Poseidon hash equals the enrolled
     public baseline  → device/identity binding, and
  2. the behavioral riskScore ≤ the public threshold,
WITHOUT revealing the raw feature vector, the secret, or the exact risk score.

Verification is pure Python via `py_ecc` (no Node, no native libs → runs on
Render). The verification key was produced by the trusted setup in
`blockchain/zkp/` and is shipped at `app/zkp/verification_key.json`.

Graceful degradation: if py_ecc or the vkey is missing, available=False and
verify() returns a NEUTRAL (None) result — the passport module is simply skipped.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_VKEY_PATH = os.path.join(os.path.dirname(__file__), "..", "zkp", "verification_key.json")

try:
    from py_ecc.bn128 import add, multiply, neg, pairing, FQ, FQ2, FQ12  # type: ignore
    _ECC_OK = True
except Exception:  # noqa: BLE001
    _ECC_OK = False
    logger.warning("⚠️  py_ecc not installed — zk-SNARK passport verification disabled")

# BN254 scalar field order — public inputs must be < r.
_FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617


def _g1(p):
    return (FQ(int(p[0])), FQ(int(p[1])))


def _g2(p):
    return (FQ2([int(p[0][0]), int(p[0][1])]), FQ2([int(p[1][0]), int(p[1][1])]))


class ZKPassportVerifier:
    def __init__(self) -> None:
        self.available = False
        self._vk: Optional[dict] = None
        if not _ECC_OK:
            return
        try:
            with open(os.path.abspath(_VKEY_PATH)) as fh:
                self._vk = json.load(fh)
            if self._vk.get("protocol") != "groth16":
                logger.warning("zk vkey protocol is not groth16 — disabling")
                return
            self.available = True
            logger.info("✅ zk-SNARK passport verifier ready (Groth16 / %s)", self._vk.get("curve", "bn128"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("zk vkey load failed: %s", exc)

    def verify(self, proof: dict, public_signals: list) -> Optional[bool]:
        """Return True/False for a proof, or None if verification is unavailable
        or the inputs are malformed (NEUTRAL — never counted as a valid pass)."""
        if not self.available or self._vk is None:
            return None
        try:
            pub = [int(s) % _FIELD_R for s in public_signals]
            vk = self._vk
            IC = [_g1(p) for p in vk["IC"]]
            if len(pub) + 1 != len(IC):
                logger.debug("zk public/IC length mismatch")
                return False

            A = _g1(proof["pi_a"])
            B = _g2(proof["pi_b"])
            C = _g1(proof["pi_c"])
            alpha = _g1(vk["vk_alpha_1"])
            beta = _g2(vk["vk_beta_2"])
            gamma = _g2(vk["vk_gamma_2"])
            delta = _g2(vk["vk_delta_2"])

            vk_x = IC[0]
            for i, s in enumerate(pub):
                vk_x = add(vk_x, multiply(IC[i + 1], s))

            # e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
            prod = (pairing(B, neg(A)) * pairing(beta, alpha)
                    * pairing(gamma, vk_x) * pairing(delta, C))
            return prod == FQ12.one()
        except Exception as exc:  # noqa: BLE001
            logger.debug("zk verification error: %s", exc)
            return False


_verifier: Optional[ZKPassportVerifier] = None


def get_zkp_verifier() -> ZKPassportVerifier:
    global _verifier
    if _verifier is None:
        _verifier = ZKPassportVerifier()
    return _verifier
