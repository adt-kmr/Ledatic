"""Telum on-chip AI accelerator client.

IBM LinuxONE Telum provides an on-chip AI accelerator that Citadel uses for
low-latency inference of the XGBoost, Siamese, CNN-LSTM and Isolation Forest
models inside the payment decision window. Models are exported to ONNX and
dispatched through the IBM Z Deep Learning Compiler / Snap ML runtime so that
no behavioural data leaves the system.

This module is a *design-target* client. It detects whether the Telum runtime
is available (via the ONNX Runtime IBM Z execution provider or the Snap ML
package) and, when it is not, falls back to ordinary CPU inference without
raising. It is never imported by the live request path.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Runtime detection (all optional, all non-fatal)
# ---------------------------------------------------------------------------
try:
    import onnxruntime as _ort  # type: ignore
    _ONNX_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    _ort = None  # type: ignore
    _ONNX_AVAILABLE = False

try:
    import snapml  # type: ignore  # IBM Snap ML (s390x wheels)
    _SNAPML_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    snapml = None  # type: ignore
    _SNAPML_AVAILABLE = False


def _telum_provider_available() -> bool:
    """True when an ONNX Runtime execution provider targeting Telum is present."""
    if not _ONNX_AVAILABLE:
        return False
    try:
        providers = _ort.get_available_providers()  # type: ignore[union-attr]
        return any("Telum" in p or "ZDNN" in p or "IBM" in p for p in providers)
    except Exception:  # pragma: no cover - defensive
        return False


class TelumAccelerator:
    """Dispatches model inference to the Telum on-chip accelerator.

    On non-LinuxONE hosts every method returns ``available=False`` and the
    caller is expected to use its ordinary CPU path. No exception is ever
    raised to the caller.
    """

    def __init__(self) -> None:
        self._available = _telum_provider_available()
        self._sessions: Dict[str, Any] = {}
        if self._available:
            logger.info("Telum on-chip AI accelerator detected - ONNX provider active")
        else:
            logger.info(
                "Telum accelerator not available - inference will run on CPU "
                "(LinuxONE deployment target only)"
            )

    @property
    def available(self) -> bool:
        return self._available

    @property
    def provider(self) -> str:
        if not self._available:
            return "CPU"
        try:
            for p in _ort.get_available_providers():  # type: ignore[union-attr]
                if "Telum" in p or "ZDNN" in p or "IBM" in p:
                    return p
        except Exception:  # pragma: no cover
            pass
        return "Telum"

    def load_onnx(self, model_path: str, name: Optional[str] = None) -> Optional[Any]:
        """Load an ONNX model onto the Telum execution provider."""
        if not self._available:
            return None
        key = name or model_path
        if key in self._sessions:
            return self._sessions[key]
        try:
            opts = _ort.SessionOptions()  # type: ignore[union-attr]
            opts.graph_optimization_level = _ort.GraphOptimizationLevel.ORT_ENABLE_ALL  # type: ignore[union-attr]
            sess = _ort.InferenceSession(  # type: ignore[union-attr]
                model_path,
                sess_options=opts,
                providers=[self.provider, "CPUExecutionProvider"],
            )
            self._sessions[key] = sess
            logger.info("Loaded ONNX model %s on %s", model_path, self.provider)
            return sess
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Telum ONNX load failed for %s: %s", model_path, exc)
            return None

    def infer(self, session: Any, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Run inference; returns {} when the accelerator is unavailable."""
        if not self._available or session is None:
            return {}
        try:
            t0 = time.perf_counter()
            out = session.run(None, inputs)
            dt = (time.perf_counter() - t0) * 1000.0
            logger.debug("Telum inference completed in %.2f ms", dt)
            return {"outputs": out, "latency_ms": round(dt, 3), "provider": self.provider}
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Telum inference failed: %s", exc)
            return {}

    def benchmark(self, model_path: str, sample_inputs: Dict[str, Any],
                  runs: int = 50) -> Dict[str, float]:
        """Telum vs CPU latency comparison (design-target, no-op off LinuxONE)."""
        if not self._available:
            return {"telum_ms": 0.0, "cpu_ms": 0.0, "speedup": 0.0, "available": False}
        sess = self.load_onnx(model_path)
        telum_times: List[float] = []
        for _ in range(runs):
            t0 = time.perf_counter()
            self.infer(sess, sample_inputs)
            telum_times.append((time.perf_counter() - t0) * 1000.0)
        return {
            "telum_ms": round(sum(telum_times) / len(telum_times), 3),
            "cpu_ms": 0.0,
            "speedup": 0.0,
            "available": True,
            "runs": runs,
        }


# Module-level singleton (never auto-registered with the app)
telum = TelumAccelerator()


@dataclass
class TelumStatus:
    available: bool = field(default=False)
    provider: str = "CPU"
    onnx_available: bool = _ONNX_AVAILABLE
    snapml_available: bool = _SNAPML_AVAILABLE

    def as_dict(self) -> Dict[str, Any]:
        return {
            "available": self.available,
            "provider": self.provider,
            "onnx_available": self.onnx_available,
            "snapml_available": self.snapml_available,
            "note": "Design target for IBM LinuxONE; inactive on this host.",
        }


def get_status() -> TelumStatus:
    return TelumStatus(
        available=telum.available,
        provider=telum.provider,
        onnx_available=_ONNX_AVAILABLE,
        snapml_available=_SNAPML_AVAILABLE,
    )
