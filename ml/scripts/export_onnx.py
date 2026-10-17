"""Export Citadel's PyTorch / XGBoost models to ONNX for the Telum accelerator.

Design-target script: documents the export step Citadel would run on LinuxONE
before deployment. It does not require the models to be present and exits
cleanly when dependencies are missing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "backend"))

try:
    import torch  # type: ignore
    _TORCH = True
except ImportError:  # pragma: no cover
    _TORCH = False

try:
    import onnx  # type: ignore
    _ONNX = True
except ImportError:  # pragma: no cover
    _ONNX = False


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Citadel models to ONNX for Telum")
    parser.add_argument("--out", default="ml/models/onnx", help="output directory")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    report = {"torch": _TORCH, "onnx": _ONNX, "exports": []}

    # BehaveFormer + Siamese
    report["exports"].append({
        "model": "behaveformer_siamese",
        "input": "keystroke sequence 32x6",
        "output": os.path.join(args.out, "behaveformer_siamese.onnx"),
        "status": "skipped" if not (_TORCH and _ONNX) else "would-export",
    })
    # CNN-LSTM mouse drift
    report["exports"].append({
        "model": "cnn_lstm",
        "input": "mouse sequence dx/dy/velocity",
        "output": os.path.join(args.out, "cnn_lstm.onnx"),
        "status": "skipped" if not (_TORCH and _ONNX) else "would-export",
    })
    # XGBoost fraud classifier
    report["exports"].append({
        "model": "xgboost_fraud",
        "input": "40-d feature vector",
        "output": os.path.join(args.out, "xgboost_fraud.onnx"),
        "status": "skipped" if not _ONNX else "would-export",
    })

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
