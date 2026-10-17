"""
Transaction-fraud scorer for the live ML service.

Loads the trained Pipeline-C artifacts (XGBoost + COPOD) and scores a single
UPI/bank transaction. This is the path that makes the transaction-fraud models
reachable in the running app — the behavioral /score path stays separate.

Artifacts (from src/train_fraud.py, in MODEL_DIR):
  xgboost_fraud.json   — supervised fraud classifier (known patterns)
  copod_anomaly.pkl    — unsupervised anomaly detector (zero-day / unlabeled)
  fraud_scaler.pkl     — StandardScaler used by COPOD
  fraud_meta.json      — feature_names + operating_threshold

Graph features (in-degree, fan-out, etc.) need account history; callers may
pass them in the request. When absent we default to "new entity" values so a
cold transaction still scores on amount / time / type.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
from pathlib import Path
from typing import Any

import joblib
import numpy as np

logger = logging.getLogger(__name__)

# Default to ml/models resolved RELATIVE to this file, so the artifacts load on
# every platform — Docker (/app/models), Render (native python, rootDir: ml), and
# local — without needing MODEL_DIR set. An explicit MODEL_DIR env still wins.
_DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(_DEFAULT_MODEL_DIR)))
# SECURITY: MODEL_DIR must be a read-only / trusted location (only the operator
# writes artifacts there via train_fraud.py). Never point this at an untrusted
# or user-writable directory — loaded model files are code-equivalent.


def _safe_load_pkl(path: Path):
    """Load a pickle/joblib artifact with a joblib-first, pickle-fallback path.

    The COPOD/scaler artifacts were originally pickled; joblib.load is preferred
    for consistency with the rest of the project, but it transparently falls
    back to pickle.loads if the file is a plain pickle stream. If joblib fails
    for any reason, fall back to pickle.loads and log a warning so existing
    artifacts keep loading.
    """
    try:
        return joblib.load(path)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "joblib.load failed on %s (%s) — falling back to pickle.loads. "
            "Re-pickle with joblib.dump to silence this.", path, e,
        )
        return pickle.loads(path.read_bytes())


class TransactionFraudScorer:
    """Supervised (XGBoost) + unsupervised (COPOD) transaction fraud scoring."""

    def __init__(self) -> None:
        self.ready = False
        self.feature_names: list[str] = []
        self.threshold = 0.5
        self._explainer: Any = None
        try:
            import xgboost as xgb

            meta = json.loads((MODEL_DIR / "fraud_meta.json").read_text())
            self.feature_names = meta["feature_names"]
            self.threshold = float(meta.get("operating_threshold", 0.5))

            self.xgb = xgb.XGBClassifier()
            self.xgb.load_model(str(MODEL_DIR / "xgboost_fraud.json"))

            # COPOD is RAM-intensive (~212MB). Support disabling via ENABLE_COPOD=false
            # or gracefully skipping if artifacts are missing/unparseable on low-RAM hosts.
            self.copod = None
            self.scaler = None
            enable_copod = os.getenv("ENABLE_COPOD", "true").lower() == "true"
            if enable_copod and (MODEL_DIR / "copod_anomaly.pkl").exists():
                try:
                    self.copod = _safe_load_pkl(MODEL_DIR / "copod_anomaly.pkl")
                    self.scaler = _safe_load_pkl(MODEL_DIR / "fraud_scaler.pkl")
                except Exception as copod_err:
                    logger.warning("TransactionFraudScorer: COPOD skipped (%s)", copod_err)

            self.ready = True
            logger.info("TransactionFraudScorer: loaded XGBoost%s (%d features)",
                        " + COPOD" if self.copod is not None else "", len(self.feature_names))
        except Exception as e:  # noqa: BLE001
            logger.warning("TransactionFraudScorer: artifacts not loaded (%s) — "
                           "run train_fraud.py to generate them", e)
            return

        # SHAP explainer is OPTIONAL — isolated so a shap/xgboost version mismatch
        # (xgboost 3.x serialises base_score as '[5E-1]', unparseable by shap 0.46)
        # doesn't disable the whole scorer. Scoring still works; only per-txn SHAP
        # attribution falls back to feature_importances_ (see _shap_top_features).
        try:
            import shap
            self._explainer = shap.TreeExplainer(self.xgb)
        except Exception as e:  # noqa: BLE001
            logger.warning("TransactionFraudScorer: SHAP explainer unavailable (%s) — "
                           "using feature_importances_ fallback", e)

    # ── feature construction ────────────────────────────────────────────────
    def _features(self, txn: dict[str, Any]) -> np.ndarray:
        """Build the 13-feature vector (paysim order) from one transaction."""
        amount = float(txn.get("amount", 0.0))
        hour = int(txn.get("hour", 12))
        is_transfer = int(txn.get("is_transfer", 1))
        # graph stats — caller-supplied, else neutral "new entity" defaults
        dest_indegree = float(txn.get("dest_indegree", 1))
        payer_outdeg = float(txn.get("payer_outdeg", 1))
        amount_vs_payer_avg = float(txn.get("amount_vs_payer_avg", 1.0))
        recipient_novelty = int(txn.get("recipient_novelty", 1))
        payee_unique_senders = float(txn.get("payee_unique_senders", 1))
        amount_zscore_payer = float(txn.get("amount_zscore_payer", 0.0))
        payer_payee_concentration = float(txn.get("payer_payee_concentration", 0.0))

        feat = {
            "log_amount": np.log1p(amount),
            "hour": hour,
            "is_transfer": is_transfer,
            "dest_indegree": dest_indegree,
            "payer_outdeg": payer_outdeg,
            "amount_vs_payer_avg": amount_vs_payer_avg,
            "recipient_novelty": recipient_novelty,
            "is_round_amt": int(amount % 500 == 0 and amount > 0),
            "is_odd_hour": int(hour < 6 or hour >= 23),
            "payee_unique_senders": payee_unique_senders,
            "amount_zscore_payer": amount_zscore_payer,
            "payer_payee_concentration": payer_payee_concentration,
            "log_dest_indegree": np.log1p(dest_indegree),
        }
        return np.array([[feat[f] for f in self.feature_names]], dtype=np.float32)

    def _shap_top_features(self, x: np.ndarray, top_n: int = 5) -> list[dict]:
        """Per-prediction SHAP attributions for a single transaction row.

        Mirrors the shape used by the behavioral path (risk_scorer.py): each
        entry has feature, shap_value, and feature_value. Falls back to the
        global feature_importances_ if the explainer is unavailable.
        """
        if self._explainer is None:
            return self._global_top_features(x, top_n)
        try:
            shap_values = self._explainer.shap_values(x)
            # shap.TreeExplainer returns either an array or (binary) a list.
            if isinstance(shap_values, list):
                sv = shap_values[1][0] if len(shap_values) > 1 else shap_values[0][0]
            else:
                sv = np.asarray(shap_values)[0]
            order = np.argsort(np.abs(sv))[-top_n:][::-1]
            return [
                {
                    "feature":      self.feature_names[i] if i < len(self.feature_names) else f"f{i}",
                    "shap_value":    float(sv[i]),
                    "feature_value": float(x[0, i]),
                }
                for i in order
            ]
        except Exception as e:  # noqa: BLE001
            logger.warning("SHAP failed on single transaction (%s) — returning global importances", e)
            return self._global_top_features(x, top_n)

    def _global_top_features(self, x: np.ndarray, top_n: int = 5) -> list[dict]:
        """Global feature_importances_ fallback (not per-prediction)."""
        importances = getattr(self.xgb, "feature_importances_", None)
        if importances is None:
            return []
        order = np.argsort(importances)[::-1][:top_n]
        return [
            {
                "feature":      self.feature_names[i] if i < len(self.feature_names) else f"f{i}",
                "importance":    float(importances[i]),
                "feature_value": float(x[0, i]),
            }
            for i in order
        ]

    # ── single-transaction (INDICATIVE score, not a hard gate) ──────────────────
    def score(self, txn: dict[str, Any]) -> dict[str, Any]:
        if not self.ready:
            return {"ready": False, "error": "fraud models not loaded"}
        x = self._features(txn)
        fraud_prob = float(self.xgb.predict_proba(x)[0, 1])
        if self.copod is not None and self.scaler is not None:
            anomaly = float(self.copod.decision_function(self.scaler.transform(x))[0])
        else:
            anomaly = 0.0
        decision = "BLOCK" if fraud_prob >= self.threshold else "APPROVE"
        return {
            "ready": True,
            "mode": "indicative",   # single-txn has no peer context — see /score-transactions
            "fraud_probability": round(fraud_prob, 4),
            "anomaly_score": round(anomaly, 4),
            "operating_threshold": self.threshold,
            "decision": decision,
            "note": "Single-transaction score is indicative only. For a real "
                    "decision use batch ranking (/score-transactions), which "
                    "ranks each transaction against its peers.",
            "top_features": self._shap_top_features(x, top_n=5),
        }

    # ── batch ranking (the RELIABLE path) ───────────────────────────────────────
    def score_batch(self, txns: list[dict[str, Any]], flag_top_pct: float = 0.10) -> dict[str, Any]:
        """
        Score a batch and rank each transaction against its peers. Relative
        ranking transfers across datasets where an absolute threshold does not,
        so this is the trustworthy way to use the fraud models on real data.
        """
        if not self.ready:
            return {"ready": False, "error": "fraud models not loaded"}
        if not txns:
            return {"ready": True, "results": [], "n": 0}

        from scipy.stats import rankdata
        X = np.vstack([self._features(t) for t in txns])
        probs = self.xgb.predict_proba(X)[:, 1]
        if self.copod is not None and self.scaler is not None:
            anomalies = self.copod.decision_function(self.scaler.transform(X))
        else:
            anomalies = np.zeros(len(txns), dtype=np.float32)
        # combined relative score = average of the two rank-percentiles
        combined = (rankdata(probs) + rankdata(anomalies)) / (2.0 * len(txns))
        cutoff = np.quantile(combined, 1.0 - flag_top_pct) if len(txns) > 1 else 1.0

        results = []
        for i, t in enumerate(txns):
            pct = float(combined[i])
            results.append({
                "index": i,
                "fraud_probability": round(float(probs[i]), 4),
                "anomaly_score": round(float(anomalies[i]), 4),
                "risk_percentile": round(pct * 100, 1),
                "flagged": bool(pct >= cutoff and len(txns) > 1),
                "decision": "REVIEW" if (pct >= cutoff and len(txns) > 1) else "APPROVE",
            })
        results.sort(key=lambda r: r["risk_percentile"], reverse=True)
        # Batch path: global feature_importances_ is acceptable, but label it
        # clearly as GLOBAL (not per-prediction SHAP) so callers don't mistake it
        # for per-row attribution.
        global_importances = []
        importances = getattr(self.xgb, "feature_importances_", None)
        if importances is not None:
            order = np.argsort(importances)[::-1][:5]
            global_importances = [
                {
                    "feature":   self.feature_names[i] if i < len(self.feature_names) else f"f{i}",
                    "importance": float(importances[i]),
                }
                for i in order
            ]
        return {"ready": True, "mode": "batch_ranking", "n": len(txns),
                "flagged_count": sum(r["flagged"] for r in results),
                "global_feature_importances": global_importances,
                "results": results}


# module-level singleton
_scorer: TransactionFraudScorer | None = None


def get_txn_scorer() -> TransactionFraudScorer | None:
    return _scorer


def init_txn_scorer() -> None:
    global _scorer
    _scorer = TransactionFraudScorer()
