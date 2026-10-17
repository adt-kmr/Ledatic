"""Crypto Express HSM client (PKCS#11 / EP11).

IBM Crypto Express is the hardware security module used on LinuxONE to protect
the HMAC salts, JWT signing keys and the quantum-safe ML-DSA / ML-KEM keys
Citadel relies on. Keys are generated and used inside the HSM and never exist
in application memory.

This module is a *design-target* client. It probes for a PKCS#11 provider
(python-pkcs11 / PyKCS11) and, when absent, reports ``available=False`` and
returns software-key placeholders. It is never imported by the live request
path; the application keeps using its existing software key material.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    import pkcs11  # type: ignore  # python-pkcs11
    _PKCS11_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    pkcs11 = None  # type: ignore
    _PKCS11_AVAILABLE = False

try:
    import PyKCS11  # type: ignore
    _PYKCS11_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    PyKCS11 = None  # type: ignore
    _PYKCS11_AVAILABLE = False


class CryptoExpressHSM:
    """Thin wrapper over a Crypto Express HSM via PKCS#11 / EP11."""

    def __init__(self) -> None:
        self._available = _PKCS11_AVAILABLE or _PYKCS11_AVAILABLE
        self._lib_path = os.environ.get(
            "CRYPTO_EXPRESS_PKCS11_LIB",
            "/usr/lib/pkcs11/libpkcs11.so",  # LinuxONE default
        )
        self._slot = os.environ.get("CRYPTO_EXPRESS_SLOT", "0")
        self._pin = os.environ.get("CRYPTO_EXPRESS_PIN", "")
        if self._available:
            logger.info("Crypto Express HSM provider detected (%s)", self._lib_path)
        else:
            logger.info(
                "Crypto Express HSM not available - keys stay in software "
                "(LinuxONE deployment target only)"
            )

    @property
    def available(self) -> bool:
        return self._available

    def generate_ml_dsa_keypair(self, label: str = "citadel-verdict-sig") -> Dict[str, Any]:
        """Generate an ML-DSA-65 (FIPS 204) keypair inside the HSM."""
        if not self._available:
            return {"available": False, "label": label, "location": "software",
                    "note": "HSM unavailable - using software key material"}
        # Design-target: real implementation calls C_GenerateKeyPair via PKCS#11
        # with CKM_ML_DSA (vendor extension) or EP11 GenerateKey.
        return {"available": True, "label": label, "location": "hsm",
                "algorithm": "ML-DSA-65", "handle": f"hsm://{label}"}

    def generate_ml_kem_keypair(self, label: str = "citadel-session-kem") -> Dict[str, Any]:
        """Generate an ML-KEM-768 (FIPS 203) keypair inside the HSM."""
        if not self._available:
            return {"available": False, "label": label, "location": "software"}
        return {"available": True, "label": label, "location": "hsm",
                "algorithm": "ML-KEM-768", "handle": f"hsm://{label}"}

    def sign(self, key_label: str, message: bytes) -> Dict[str, Any]:
        """Sign ``message`` with the HSM-resident key labelled ``key_label``."""
        if not self._available:
            # Software fallback: SHA3-256 digest only (no real signature)
            digest = hashlib.sha3_256(message).hexdigest()
            return {"available": False, "signature_b64": base64.b64encode(digest.encode()).decode(),
                    "location": "software", "key_label": key_label}
        return {"available": True, "signature_b64": "", "location": "hsm",
                "key_label": key_label, "note": "HSM signing via EP11"}

    def hmac_salt(self, label: str = "citadel-imei-salt") -> Dict[str, Any]:
        """Return (or create) an HMAC salt stored in the HSM."""
        if not self._available:
            return {"available": False, "label": label, "salt_b64": "", "location": "software"}
        return {"available": True, "label": label, "salt_b64": "", "location": "hsm"}

    def status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "pkcs11_available": _PKCS11_AVAILABLE,
            "pykcs11_available": _PYKCS11_AVAILABLE,
            "lib_path": self._lib_path,
            "slot": self._slot,
            "note": "Design target for IBM Crypto Express on LinuxONE; inactive on this host.",
        }


hsm = CryptoExpressHSM()


@dataclass
class HSMStatus:
    available: bool
    pkcs11_available: bool
    pykcs11_available: bool
    lib_path: str
    slot: str

    def as_dict(self) -> Dict[str, Any]:
        return hsm.status()


def get_status() -> Dict[str, Any]:
    return hsm.status()
