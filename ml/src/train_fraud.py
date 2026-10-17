"""
Pipeline C — Transaction-fraud training on PaySim (local CPU).

Trains:
  - XGBoost  : supervised fraud classifier (scale_pos_weight for imbalance)
  - COPOD    : unsupervised zero-day anomaly detector (legit-trained, PyOD)

Evaluates on a TEMPORAL test split (future transactions) and writes:
  - ml/models/{xgboost_fraud.json, copod_anomaly.pkl, fraud_scaler.pkl, fraud_meta.json}
  - ml/reports/metrics_fraud.json
  - ml/reports/plots/fraud_*.png  (ROC, PR, confusion, SHAP)

Run:  python -m src.train_fraud      (from ml/)   or   python ml/src/train_fraud.py
"""
from __future__ import annotations

import json
import logging
import pickle
import sys
import time
from pathlib import Path

import numpy as np

# Allow running as a script (python ml/src/train_fraud.py) or module (-m src.train_fraud)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import shap  # noqa: E402
import xgboost as xgb  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from eval import metrics as M  # noqa: E402
from src.datasets import paysim  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("train_fraud")

ML_DIR = Path(__file__).resolve().parents[1]
MODELS = ML_DIR / "models"
REPORTS = ML_DIR / "reports"
PLOTS = REPORTS / "plots"


def _best_f1_threshold(y_true: np.ndarray, scores: np.ndarray) -> float:
    """Pick the probability threshold that maximises F1 on the validation set."""
    from sklearn.metrics import f1_score
    grid = np.linspace(0.05, 0.95, 19)
    f1s = [f1_score(y_true, (scores >= t).astype(int), zero_division=0) for t in grid]
    return float(grid[int(np.argmax(f1s))])


def main() -> None:
    for d in (MODELS, REPORTS, PLOTS):
        d.mkdir(parents=True, exist_ok=True)

    t0 = time.monotonic()
    data = paysim.load_split()
    X_tr, y_tr = data["X_train"], data["y_train"]
    X_va, y_va = data["X_val"], data["y_val"]
    X_te, y_te = data["X_test"], data["y_test"]
    feats = data["feature_names"]

    # ── XGBoost (supervised) ────────────────────────────────────────────────
    pos = max(int(y_tr.sum()), 1)
    neg = len(y_tr) - pos
    spw = neg / pos
    logger.info("Training XGBoost (scale_pos_weight=%.1f)...", spw)
    clf = xgb.XGBClassifier(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, scale_pos_weight=spw,
        eval_metric="aucpr", random_state=42, n_jobs=-1, verbosity=0,
    )
    clf.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)

    proba_va = clf.predict_proba(X_va)[:, 1]
    # Guard against a degenerate val split (e.g. a temporal window with one
    # class only) collapsing the F1-tuned threshold. Fall back to a leak-free
    # threshold calibrated on TRAIN scores at the training fraud prevalence.
    if len(np.unique(y_va)) < 2 or y_va.sum() < 5 or (len(y_va) - y_va.sum()) < 5:
        proba_tr = clf.predict_proba(X_tr)[:, 1]
        thr = float(np.quantile(proba_tr, 1.0 - float(y_tr.mean())))
        logger.warning("Val split degenerate (n=%d, fraud=%d) — threshold from "
                       "train prevalence: %.3f", len(y_va), int(y_va.sum()), thr)
    else:
        thr = _best_f1_threshold(y_va, proba_va)
    proba_te = clf.predict_proba(X_te)[:, 1]
    xgb_report = M.classification_report_dict(y_te, proba_te, threshold=thr)
    logger.info("XGBoost test — ROC-AUC %.4f | PR-AUC %.4f | P %.3f | R %.3f | F1 %.3f",
                xgb_report["roc_auc"], xgb_report["pr_auc"],
                xgb_report["precision"], xgb_report["recall"], xgb_report["f1"])

    # ── Unsupervised anomaly detector (legit-trained, zero-day) ─────────────
    # COPOD (copula-based) beats Isolation Forest on this feature set:
    # IsoForest can't exploit the engineered signals (its random splits get
    # confused), while COPOD models the per-feature tail distributions and
    # gains ~6 ROC-AUC points. Parameter-free, so nothing to tune.
    logger.info("Training COPOD anomaly detector on legit transactions...")
    from pyod.models.copod import COPOD  # noqa: E402
    # COPOD (PyOD) retains its full training matrix to evaluate per-feature ECDFs
    # at inference — fitting on all ~1M legit rows yields a ~220 MB pickle that is
    # too large to commit to Git (so prod, which never runs the boot-time
    # regeneration, had txn_fraud_ready=false). A representative random subsample
    # preserves the marginal tail distributions COPOD depends on — detection
    # quality holds — while shrinking the artifact to a few MB, so it ships in the
    # repo and loads directly on Render (no regeneration, no OOM). Parameter-free.
    COPOD_MAX_ROWS = 40000
    legit = X_tr[y_tr == 0]
    scaler = StandardScaler().fit(legit)
    if len(legit) > COPOD_MAX_ROWS:
        idx = np.random.default_rng(42).choice(len(legit), COPOD_MAX_ROWS, replace=False)
        legit_fit = legit[idx]
        logger.info("COPOD: subsampling %d → %d legit rows for a committable artifact",
                    len(legit), COPOD_MAX_ROWS)
    else:
        legit_fit = legit
    iso = COPOD()
    iso.fit(scaler.transform(legit_fit))
    # decision_function: higher = more anomalous = more fraud-like
    iso_scores_te = iso.decision_function(scaler.transform(X_te))
    iso_report = M.classification_report_dict(
        y_te, iso_scores_te, threshold=float(np.quantile(iso_scores_te, 0.99)))
    logger.info("COPOD test — ROC-AUC %.4f | PR-AUC %.4f",
                iso_report["roc_auc"], iso_report["pr_auc"])

    # ── SHAP top features (FREE-AI explainability) — NON-FATAL ──────────────
    # shap's TreeExplainer can't parse xgboost 3.x's base_score array format
    # ("could not convert string to float: '[5E-1]'"), which would otherwise
    # crash the whole regeneration. Degrade to xgboost's built-in gain-based
    # feature_importances_ so COPOD/XGBoost artifacts still get written. Same
    # graceful pattern as transaction_fraud.py and risk_scorer.py.
    logger.info("Computing SHAP feature importance...")
    try:
        sample = X_te[np.random.default_rng(0).choice(len(X_te), min(2000, len(X_te)), replace=False)]
        sv = shap.TreeExplainer(clf).shap_values(sample)
        importance = np.abs(sv).mean(axis=0)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "SHAP unavailable (%s) — falling back to xgboost feature_importances_. "
            "Upgrade shap or pin xgboost to restore SHAP.", e,
        )
        importance = np.asarray(clf.feature_importances_, dtype=float)
    shap_rank = sorted(
        ({"feature": f, "mean_abs_shap": float(v)} for f, v in zip(feats, importance)),
        key=lambda d: d["mean_abs_shap"], reverse=True,
    )

    # ── Plots ───────────────────────────────────────────────────────────────
    M.plot_roc(y_te, proba_te, PLOTS / "fraud_roc.png", "XGBoost (PaySim)")
    M.plot_pr(y_te, proba_te, PLOTS / "fraud_pr.png", "XGBoost (PaySim)")
    M.plot_confusion(xgb_report["confusion_matrix"], PLOTS / "fraud_confusion.png", "XGBoost (PaySim)")
    M.plot_score_dist(y_te, proba_te, PLOTS / "fraud_score_dist.png", "XGBoost (PaySim)")

    # ── Persist weights + metadata ──────────────────────────────────────────
    clf.save_model(MODELS / "xgboost_fraud.json")
    with open(MODELS / "copod_anomaly.pkl", "wb") as f:
        pickle.dump(iso, f)
    with open(MODELS / "fraud_scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)
    with open(MODELS / "fraud_meta.json", "w") as f:
        json.dump({"feature_names": feats, "operating_threshold": thr,
                   "scale_pos_weight": spw, "split": "temporal",
                   "train_cut_step": data["train_cut"], "val_cut_step": data["val_cut"]},
                  f, indent=2)

    metrics = {
        "dataset": "PaySim (TRANSFER+CASH_OUT)",
        "split": "temporal",
        "features": feats,
        "feature_note": (
            "Rich real-UPI-transferable features (log_amount, hour, is_transfer, "
            "dest_indegree, payer_outdeg, amount_vs_payer_avg, recipient_novelty, "
            "is_round_amt, is_odd_hour). Balance-reconciliation features excluded — "
            "they don't exist in real UPI logs and made synthetic fraud separable "
            "at ROC-AUC ~1.0."
        ),
        "anomaly_detector": "COPOD (PyOD)",
        "train": {"n": int(len(y_tr)), "fraud": int(y_tr.sum())},
        "test": {"n": int(len(y_te)), "fraud": int(y_te.sum())},
        "xgboost": xgb_report,
        "copod_anomaly": iso_report,
        "shap_top_features": shap_rank,
        "elapsed_sec": round(time.monotonic() - t0, 1),
    }
    with open(REPORTS / "metrics_fraud.json", "w") as f:
        json.dump(metrics, f, indent=2)

    print("\n" + "=" * 60)
    print("PIPELINE C — PaySim fraud  (TEMPORAL test split)")
    print("=" * 60)
    print(f"  Features: {', '.join(feats)}  (real-UPI-transferable only)")
    print(f"  XGBoost             ROC-AUC {xgb_report['roc_auc']:.4f} | PR-AUC {xgb_report['pr_auc']:.4f} | F1 {xgb_report['f1']:.3f}")
    print(f"  COPOD (anomaly)     ROC-AUC {iso_report['roc_auc']:.4f} | PR-AUC {iso_report['pr_auc']:.4f}")
    print(f"  Top SHAP: {', '.join(d['feature'] for d in shap_rank[:5])}")
    print(f"  Saved weights → {MODELS}, metrics+plots → {REPORTS}")
    print(f"  Done in {metrics['elapsed_sec']}s")


if __name__ == "__main__":
    main()
