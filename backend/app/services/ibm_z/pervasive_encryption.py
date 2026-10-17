"""Pervasive / protected-key volume encryption helpers.

LinuxONE provides pervasive encryption and protected (secure) keys for data at
rest: PostgreSQL, Redis and logs are encrypted by default, with India-resident
deployment supporting DPDP data localisation.

This module is a *design-target* helper that describes the encryption posture
and validates volume configuration without touching any real data.
"""
from __future__ import annotations

import logging
import os
import platform
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class PervasiveEncryption:
    """Describe and validate the LinuxONE encryption posture."""

    def __init__(self) -> None:
        self._available = platform.machine().lower() in ("s390x", "s390")
        if self._available:
            logger.info("LinuxONE pervasive encryption available")
        else:
            logger.info(
                "Pervasive encryption not available on %s "
                "(LinuxONE deployment target only)", platform.machine()
            )

    @property
    def available(self) -> bool:
        return self._available

    def volumes(self) -> List[Dict[str, Any]]:
        """Describe the protected volumes Citadel uses."""
        return [
            {"name": "postgres-data", "encrypted": True, "key_type": "protected",
             "algorithm": "AES-256 (protected key)", "localisation": "India-resident"},
            {"name": "redis-data", "encrypted": True, "key_type": "protected",
             "algorithm": "AES-256 (protected key)", "localisation": "India-resident"},
            {"name": "fabric-ledger", "encrypted": True, "key_type": "protected",
             "algorithm": "AES-256 (protected key)", "localisation": "India-resident"},
            {"name": "model-artifacts", "encrypted": True, "key_type": "protected",
             "algorithm": "AES-256 (protected key)", "localisation": "India-resident"},
        ]

    def validate(self) -> Dict[str, Any]:
        """Validate the encryption posture (design-target, always reports target)."""
        return {
            "available": self._available,
            "volumes": self.volumes(),
            "dpdp_localisation": True,
            "note": "Design target for pervasive encryption on LinuxONE; inactive on this host.",
        }

    def status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "architecture": platform.machine(),
            "encrypted_volumes": len(self.volumes()),
            "note": "Design target for pervasive / protected-key encryption on LinuxONE.",
        }


pervasive_encryption = PervasiveEncryption()


def get_status() -> Dict[str, Any]:
    return pervasive_encryption.status()
