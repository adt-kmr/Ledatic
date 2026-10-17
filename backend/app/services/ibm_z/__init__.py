"""IBM Z / LinuxONE design-target package for Citadel.

Self-contained, environment-gated modules that describe the IBM Z capabilities
Citadel maps onto in its LinuxONE deployment. None of these are imported by
the live request path; the application behaves identically on x86 / ARM.

See backend/app/services/ibm_z/ for the implementation modules.
"""
from __future__ import annotations

__all__ = ["ibm_z"]
