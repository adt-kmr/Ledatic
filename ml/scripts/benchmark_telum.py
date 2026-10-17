"""Benchmark Telum on-chip AI vs CPU inference for Citadel's models.

Design-target script: reports the latency comparison Citadel would publish
from its LinuxONE replay suite. Runs as a no-op when the Telum runtime is
absent.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "backend"))

try:
    import onnxruntime as ort  # type: ignore
    _ORT = True
except ImportError:  # pragma: no cover
    _ORT = False


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark Telum vs CPU inference")
    parser.add_argument("--model", default="ml/models/onnx/behaveformer_siamese.onnx")
    parser.add_argument("--runs", type=int, default=50)
    args = parser.parse_args()

    result = {
        "model": args.model,
        "runs": args.runs,
        "telum_ms": 0.0,
        "cpu_ms": 0.0,
        "speedup": 0.0,
        "telum_available": False,
    }

    if not _ORT:
        print(json.dumps(result, indent=2))
        return 0

    providers = ort.get_available_providers() if _ORT else []
    telum_provider = next((p for p in providers if "Telum" in p or "ZDNN" in p or "IBM" in p), None)
    result["telum_available"] = telum_provider is not None
    result["providers"] = providers

    if telum_provider is None:
        print(json.dumps(result, indent=2))
        return 0

    # Design-target: real benchmark would load the session and time inference.
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
