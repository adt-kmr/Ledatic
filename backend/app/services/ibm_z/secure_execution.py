"""IBM Secure Execution for Linux.

Secure Execution provides confidential, encrypted guest workloads on LinuxONE:
the decision engine, ML service and AI investigator run inside a guest whose
memory and state are protected from privileged administrators and the host.

This module is a *design-target* helper. It inspects the running kernel for
Secure Execution markers (s390x, /sys/firmware/uv) and, when absent, reports
``available=False``. It never launches a real guest.
"""
from __future__ import annotations

import logging
import os
import platform
from dataclasses import dataclass
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _detect_secure_execution() -> bool:
    """True when running inside an IBM Secure Execution guest on s390x."""
    if platform.machine().lower() not in ("s390x", "s390"):
        return False
    # Secure Execution guests expose the ultravisor via /sys/firmware/uv
    return os.path.exists("/sys/firmware/uv") or os.path.exists("/proc/uv")


class SecureExecution:
    """Attestation and launch helpers for Secure Execution guests."""

    def __init__(self) -> None:
        self._available = _detect_secure_execution()
        if self._available:
            logger.info("IBM Secure Execution guest detected")
        else:
            logger.info(
                "Secure Execution not available - running on %s "
                "(LinuxONE deployment target only)", platform.machine()
            )

    @property
    def available(self) -> bool:
        return self._available

    @property
    def architecture(self) -> str:
        return platform.machine()

    def attestation_report(self) -> Dict[str, Any]:
        """Return a (stub) attestation report for the current guest."""
        if not self._available:
            return {
                "available": False,
                "architecture": self.architecture,
                "attested": False,
                "note": "Design target for IBM Secure Execution on LinuxONE; inactive on this host.",
            }
        # Design-target: read /sys/firmware/uv/... and verify the measurement.
        return {
            "available": True,
            "architecture": self.architecture,
            "attested": True,
            "measurement": "0x" + "0" * 64,
            "uv_version": "1.0",
        }

    def launch_guest(self, image: str, memory_mb: int = 4096) -> Dict[str, Any]:
        """Design-target: launch an encrypted Secure Execution guest."""
        return {
            "available": self._available,
            "image": image,
            "memory_mb": memory_mb,
            "status": "would-launch" if self._available else "skipped",
            "note": "No guest is launched by this stub.",
        }

    def status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "architecture": self.architecture,
            "secure_execution": self._available,
            "note": "Design target for IBM Secure Execution on LinuxONE; inactive on this host.",
        }


secure_execution = SecureExecution()


@dataclass
class SecureExecutionStatus:
    available: bool
    architecture: str
    secure_execution: bool

    def as_dict(self) -> Dict[str, Any]:
        return secure_execution.status()


def get_status() -> Dict[str, Any]:
    return secure_execution.status()
