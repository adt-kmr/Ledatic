"""ONNX export and Snap ML benchmarking helpers.

Citadel's PyTorch / XGBoost models are exported to ONNX and dispatched to the
Telum accelerator through Snap ML, then benchmarked against CPU inference so
the replay suite can report measured latency evidence.

This module is a *design-target* helper. It imports onnx / onnxruntime only when
present and otherwise returns structured "skipped" results. It is never invoked
by the live request path.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    import onnx  # type: ignore
    _ONNX_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    onnx = None  # type: ignore
    _ONNX_AVAILABLE = False

try:
    import torch  # type: ignore
    _TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    torch = None  # type: ignore
    _TORCH_AVAILABLE = False


class OnnxSnapML:
    """Model export + Telum-vs-CPU benchmarking helpers."""

    def __init__(self) -> None:
        self._available = _ONNX_AVAILABLE
        if self._available:
            logger.info("ONNX available - model export enabled")
        else:
            logger.info("ONNX not available - export skipped (LinuxONE deployment target)")

    @property
    def available(self) -> bool:
        return self._available

    def export_torch(self, model: Any, dummy_input: Any, out_path: str,
                     opset: int = 17) -> Dict[str, Any]:
        """Export a PyTorch model to ONNX (design-target)."""
        if not (self._available and _TORCH_AVAILABLE):
            return {"available": False, "out_path": out_path,
                    "note": "torch/onnx not available on this host"}
        try:
            torch.onnx.export(  # type: ignore[union-attr]
                model, dummy_input, out_path, opset_version=opset,
                input_names=["input"], output_names=["output"],
                dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
            )
            size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
            return {"available": True, "out_path": out_path, "bytes": size,
                    "opset": opset}
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("ONNX export failed: %s", exc)
            return {"available": False, "out_path": out_path, "error": str(exc)}

    def export_xgboost(self, booster: Any, out_path: str) -> Dict[str, Any]:
        """Export an XGBoost booster to ONNX (design-target)."""
        if not self._available:
            return {"available": False, "out_path": out_path}
        return {"available": True, "out_path": out_path,
                "note": "Use onnxmltools / xgboost-onnx converter on LinuxONE"}

    def benchmark(self, onnx_path: str, sample: Any, runs: int = 50) -> Dict[str, Any]:
        """Telum vs CPU latency comparison (design-target)."""
        if not self._available:
            return {"available": False, "telum_ms": 0.0, "cpu_ms": 0.0,
                    "speedup": 0.0, "runs": 0}
        return {"available": True, "telum_ms": 0.0, "cpu_ms": 0.0,
                "speedup": 0.0, "runs": runs,
                "note": "Populate on LinuxONE with Telum provider active"}

    def status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "torch_available": _TORCH_AVAILABLE,
            "onnx_available": _ONNX_AVAILABLE,
            "note": "Design target for ONNX / Snap ML on IBM LinuxONE; inactive on this host.",
        }


onnx_snapml = OnnxSnapML()


def get_status() -> Dict[str, Any]:
    return onnx_snapml.status()
