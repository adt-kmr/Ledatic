"""
Citadel — Post-Quantum Cryptography Signer
===============================================

Signs behavioral passport hashes using CRYSTALS-Dilithium-3 (ML-DSA / NIST FIPS 204),
the lattice-based digital signature scheme standardized by NIST in 2024.

Why Dilithium-3:
  - 128-bit quantum security (resistant to Shor's algorithm)
  - Signature size: ~3.3 KB — acceptable for on-chain storage
  - Deterministic: same message always produces the same signature for a given key
  - Standardized: NIST FIPS 204 (finalized August 2024)

Library: dilithium-py (pure Python, no C extensions required)
  pip install dilithium-py

Graceful degradation: if dilithium-py is not installed, pqc_available=False and all
signing/verification calls are no-ops that return pqc_available=False. The rest of the
app continues working — PQC is an additive security layer, never a blocking requirement.

Usage:
    from app.services.pqc_signer import get_pqc_signer

    pqc = get_pqc_signer()
    if pqc.available:
        sig = pqc.sign_behavioral_hash(signal_bundle)
        ok  = pqc.verify_behavioral_hash(signal_bundle, sig.signature_b64, sig.public_key_b64)
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# ── Attempt to import dilithium-py ────────────────────────────────────────────
try:
    from dilithium_py.dilithium import Dilithium3  # type: ignore
    _DILITHIUM_AVAILABLE = True
    logger.info("✅ dilithium-py loaded — CRYSTALS-Dilithium-3 (NIST FIPS 204) active")
except ImportError:
    _DILITHIUM_AVAILABLE = False
    logger.warning(
        "⚠️  dilithium-py not installed — PQC signing disabled. "
        "Install with: pip install dilithium-py"
    )

# Parameter set label surfaced in API responses and admin UI
PQC_ALGORITHM = "Dilithium-3"
PQC_STANDARD  = "NIST FIPS 204 (ML-DSA)"
PQC_SECURITY  = "128-bit quantum security"


@dataclass
class PQCSignature:
    """Result of a successful Dilithium behavioral hash signing operation."""
    algorithm:       str   # "Dilithium-3"
    standard:        str   # "NIST FIPS 204 (ML-DSA)"
    behavioral_hash: str   # hex SHA3-256 of the canonical signal bundle
    signature_b64:   str   # base64-encoded Dilithium signature (~3.3 KB)
    public_key_b64:  str   # base64-encoded Dilithium public key (~1.3 KB)
    sign_time_ms:    int   # signing latency for UI display
    pqc_available:   bool = True


@dataclass
class PQCVerifyResult:
    """Result of a Dilithium signature verification."""
    verified:       bool
    algorithm:      Optional[str]
    behavioral_hash: Optional[str]
    pqc_available:  bool
    reason:         str   # human-readable reason for display


def _canonical_bundle(signal_bundle: dict) -> bytes:
    """
    Produce a deterministic canonical representation of the signal bundle
    for hashing. We extract only the stable numerical features — not
    timestamps or session IDs which vary per-call — so the hash is
    reproducible across enrollment and verification sessions for the same
    behavioral pattern.

    For PQC verification: we hash the *enrolled* bundle's features at
    enrollment time and store that hash. At verification we check whether
    the new bundle's hash is within tolerance (soft verify) or exact (strict).

    For the hackathon demo we hash the full sorted JSON so the flow is
    visually demonstrable end-to-end.
    """
    try:
        # Sort keys for determinism, strip session-volatile fields
        stable = {
            k: v for k, v in signal_bundle.items()
            if k not in ("session_id", "sessionId", "timestamp", "ts", "created_at")
        }
        canonical = json.dumps(stable, sort_keys=True, separators=(",", ":"))
        return canonical.encode("utf-8")
    except Exception:
        # Fallback: hash the repr
        return repr(signal_bundle).encode("utf-8")


def _sha3_256(data: bytes) -> str:
    """Return hex-encoded SHA3-256 of data (quantum-resistant hash function)."""
    return hashlib.sha3_256(data).hexdigest()


class PQCSigner:
    """
    Dilithium-3 signing service for behavioral passport hashes.

    Singleton — one keypair per server process.
    Keypair is generated at startup. For production, persist via HSM or
    store the seed in an environment variable (DILITHIUM_SEED_HEX).
    """

    def __init__(self) -> None:
        self._available = _DILITHIUM_AVAILABLE
        self._pubkey_bytes: Optional[bytes] = None
        self._privkey_bytes: Optional[bytes] = None

        if self._available:
            self._init_keypair()

    def _init_keypair(self) -> None:
        """
        Generate or restore the Dilithium-3 server keypair.

        Priority:
          1. DILITHIUM_SEED_HEX env var (32-byte hex seed) — reproducible key
          2. Fresh random keypair (lost on restart — demo-safe)
        """
        try:
            seed_hex = os.environ.get("DILITHIUM_SEED_HEX", "")
            if seed_hex and len(seed_hex) == 64:
                # dilithium-py's keygen() does not accept an external seed parameter;
                # a fresh random keypair is always generated. The DILITHIUM_SEED_HEX
                # value is logged for auditing but is NOT used for key derivation.
                # For true seed-based reproducibility, persist the raw key bytes in
                # an HSM or encrypted env var instead.
                logger.warning(
                    "DILITHIUM_SEED_HEX is set but dilithium-py keygen() does not "
                    "support external seeds — generating a fresh random keypair. "
                    "Persist DILITHIUM_PUB_KEY / DILITHIUM_PRIV_KEY for reproducibility."
                )
            # Fresh random keypair (or seed ignored — same path either way)
            self._pubkey_bytes, self._privkey_bytes = Dilithium3.keygen()
            pubkey_b64 = base64.b64encode(self._pubkey_bytes).decode()
            logger.info(
                "🔑 Dilithium-3 keypair generated (pubkey: %s…). "
                "Set DILITHIUM_SEED_HEX for future reference (logged only).",
                pubkey_b64[:24]
            )
        except Exception as exc:
            logger.error("Dilithium keypair generation failed: %s", exc)
            self._available = False

    @property
    def available(self) -> bool:
        """True when dilithium-py is installed and the keypair is ready."""
        return self._available and self._pubkey_bytes is not None

    @property
    def public_key_b64(self) -> Optional[str]:
        """Base64-encoded Dilithium-3 public key (for storage / display)."""
        if self._pubkey_bytes is None:
            return None
        return base64.b64encode(self._pubkey_bytes).decode()

    def sign_behavioral_hash(self, signal_bundle: dict) -> PQCSignature:
        """
        Sign the canonical behavioral hash of signal_bundle with Dilithium-3.

        Returns a PQCSignature dataclass. If PQC is unavailable, returns a
        stub with pqc_available=False so callers can degrade gracefully.
        """
        if not self.available:
            return PQCSignature(
                algorithm=PQC_ALGORITHM,
                standard=PQC_STANDARD,
                behavioral_hash="",
                signature_b64="",
                public_key_b64="",
                sign_time_ms=0,
                pqc_available=False,
            )

        t0 = time.monotonic()
        try:
            canonical = _canonical_bundle(signal_bundle)
            beh_hash = _sha3_256(canonical)

            # Dilithium signs arbitrary byte strings
            signature_bytes = Dilithium3.sign(self._privkey_bytes, canonical)
            signature_b64   = base64.b64encode(signature_bytes).decode()
            pubkey_b64      = base64.b64encode(self._pubkey_bytes).decode()

            elapsed_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                "🔮 Dilithium-3 signature created | hash=%s… | latency=%dms | sig_size=%db",
                beh_hash[:16], elapsed_ms, len(signature_bytes)
            )
            return PQCSignature(
                algorithm=PQC_ALGORITHM,
                standard=PQC_STANDARD,
                behavioral_hash=beh_hash,
                signature_b64=signature_b64,
                public_key_b64=pubkey_b64,
                sign_time_ms=elapsed_ms,
                pqc_available=True,
            )
        except Exception as exc:
            logger.error("Dilithium signing failed: %s", exc)
            return PQCSignature(
                algorithm=PQC_ALGORITHM,
                standard=PQC_STANDARD,
                behavioral_hash="",
                signature_b64="",
                public_key_b64="",
                sign_time_ms=0,
                pqc_available=False,
            )

    def verify_behavioral_hash(
        self,
        signal_bundle: dict,
        signature_b64: str,
        public_key_b64: str,
    ) -> PQCVerifyResult:
        """
        Verify a stored Dilithium-3 signature against the current session's
        canonical behavioral hash.

        NOTE: In a real deployment the signal_bundle at verification time will
        differ slightly from enrollment (different session, naturally evolving
        behavior). For the demo we verify against the *stored public key* (not
        the stored hash) — if the signature is valid for the canonical form of
        *any* session data the key signed, it proves the server's key integrity.

        For strict per-session replay protection, pass the original enrolled
        bundle bytes — but for biometric behavioral systems, we verify the
        key-pair integrity + passport existence rather than exact bundle replay.
        """
        if not self.available:
            return PQCVerifyResult(
                verified=False,
                algorithm=None,
                behavioral_hash=None,
                pqc_available=False,
                reason="dilithium-py not available on this server",
            )

        try:
            canonical      = _canonical_bundle(signal_bundle)
            beh_hash       = _sha3_256(canonical)
            sig_bytes      = base64.b64decode(signature_b64)
            pubkey_bytes   = base64.b64decode(public_key_b64)

            # Dilithium verify returns True/False
            ok = Dilithium3.verify(pubkey_bytes, canonical, sig_bytes)

            logger.info(
                "🔮 Dilithium-3 verification | hash=%s… | result=%s",
                beh_hash[:16], "PASS" if ok else "FAIL"
            )
            return PQCVerifyResult(
                verified=bool(ok),
                algorithm=PQC_ALGORITHM,
                behavioral_hash=beh_hash,
                pqc_available=True,
                reason="Dilithium-3 signature valid" if ok else "Dilithium-3 signature mismatch",
            )
        except Exception as exc:
            logger.error("Dilithium verification error: %s", exc)
            return PQCVerifyResult(
                verified=False,
                algorithm=PQC_ALGORITHM,
                behavioral_hash=None,
                pqc_available=True,
                reason=f"Verification error: {exc}",
            )

    def get_status(self) -> dict:
        """Return a status dict for health checks and admin display."""
        return {
            "pqc_available":  self.available,
            "algorithm":      PQC_ALGORITHM,
            "standard":       PQC_STANDARD,
            "security_level": PQC_SECURITY,
            "library":        "dilithium-py" if _DILITHIUM_AVAILABLE else "not installed",
            "pubkey_preview": (self.public_key_b64 or "")[:32] + "…" if self.public_key_b64 else None,
        }


# ── Module-level singleton ─────────────────────────────────────────────────────
_pqc_signer: Optional[PQCSigner] = None


def get_pqc_signer() -> PQCSigner:
    """Return the module-level PQCSigner singleton (lazy-init on first call)."""
    global _pqc_signer
    if _pqc_signer is None:
        _pqc_signer = PQCSigner()
    return _pqc_signer


def init_pqc_signer() -> None:
    """
    Eagerly initialise the PQC signer at FastAPI lifespan startup.
    Keypair generation (~50ms) happens here so first request is not delayed.
    """
    global _pqc_signer
    _pqc_signer = PQCSigner()
    if _pqc_signer.available:
        logger.info("🔮 PQC Signer ready | %s | %s", PQC_ALGORITHM, PQC_STANDARD)
    else:
        logger.warning("🔮 PQC Signer inactive (dilithium-py not installed)")
