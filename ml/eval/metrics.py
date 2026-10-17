"""
Shared evaluation helpers used by every training pipeline.

Provides:
  - eer()                : Equal Error Rate + operating threshold (biometric metric)
  - classification_report_dict() : precision/recall/F1/ROC-AUC/PR-AUC/confusion
  - plot helpers          : ROC, PR, confusion matrix, score distributions

All plots are saved to disk (headless 'Agg' backend) so they work in Colab,
Docker, and CI without a display.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    auc,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)


def eer(y_true: np.ndarray, scores: np.ndarray) -> tuple[float, float]:
    """
    Equal Error Rate: the threshold where FAR == FRR.
    `scores` = higher means more likely positive (impostor/fraud).
    Returns (eer, threshold).
    """
    fpr, tpr, thresholds = roc_curve(y_true, scores)
    fnr = 1 - tpr
    idx = np.nanargmin(np.abs(fnr - fpr))
    return float((fpr[idx] + fnr[idx]) / 2.0), float(thresholds[idx])


def tar_at_far(y_true: np.ndarray, scores: np.ndarray, far_target: float) -> float:
    """True Accept Rate at a target False Accept Rate (e.g. FAR=0.01)."""
    fpr, tpr, _ = roc_curve(y_true, scores)
    idx = np.searchsorted(fpr, far_target, side="right") - 1
    idx = max(0, min(idx, len(tpr) - 1))
    return float(tpr[idx])


def classification_report_dict(
    y_true: np.ndarray, scores: np.ndarray, threshold: float | None = None
) -> dict:
    """Full metric bundle for a binary scorer. Threshold defaults to 0.5."""
    thr = 0.5 if threshold is None else threshold
    y_pred = (scores >= thr).astype(int)
    e, e_thr = eer(y_true, scores)
    cm = confusion_matrix(y_true, y_pred)
    return {
        "threshold": float(thr),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, scores)),
        "pr_auc": float(average_precision_score(y_true, scores)),
        "eer": e,
        "eer_threshold": e_thr,
        "tar_at_far_1pct": tar_at_far(y_true, scores, 0.01),
        "tar_at_far_0.1pct": tar_at_far(y_true, scores, 0.001),
        "confusion_matrix": cm.tolist(),
        "n_pos": int(y_true.sum()),
        "n_total": int(len(y_true)),
    }


# ── Plots ─────────────────────────────────────────────────────────────────────

def plot_roc(y_true, scores, out: Path, title: str) -> None:
    fpr, tpr, _ = roc_curve(y_true, scores)
    plt.figure(figsize=(5, 5))
    plt.plot(fpr, tpr, label=f"AUC = {auc(fpr, tpr):.3f}")
    plt.plot([0, 1], [0, 1], "k--", alpha=0.4)
    plt.xlabel("False Positive Rate"); plt.ylabel("True Positive Rate")
    plt.title(f"ROC — {title}"); plt.legend(loc="lower right")
    plt.tight_layout(); plt.savefig(out, dpi=120); plt.close()


def plot_pr(y_true, scores, out: Path, title: str) -> None:
    prec, rec, _ = precision_recall_curve(y_true, scores)
    ap = average_precision_score(y_true, scores)
    plt.figure(figsize=(5, 5))
    plt.plot(rec, prec, label=f"PR-AUC = {ap:.3f}")
    plt.xlabel("Recall"); plt.ylabel("Precision")
    plt.title(f"Precision-Recall — {title}"); plt.legend(loc="upper right")
    plt.tight_layout(); plt.savefig(out, dpi=120); plt.close()


def plot_confusion(cm, out: Path, title: str, labels=("legit", "fraud")) -> None:
    cm = np.asarray(cm)
    plt.figure(figsize=(4.5, 4))
    plt.imshow(cm, cmap="Blues")
    for (i, j), v in np.ndenumerate(cm):
        plt.text(j, i, f"{v:,}", ha="center", va="center",
                 color="white" if v > cm.max() / 2 else "black")
    plt.xticks([0, 1], labels); plt.yticks([0, 1], labels)
    plt.xlabel("Predicted"); plt.ylabel("Actual")
    plt.title(f"Confusion — {title}")
    plt.tight_layout(); plt.savefig(out, dpi=120); plt.close()


def plot_score_dist(y_true, scores, out: Path, title: str) -> None:
    y_true = np.asarray(y_true); scores = np.asarray(scores)
    plt.figure(figsize=(5.5, 4))
    plt.hist(scores[y_true == 0], bins=50, alpha=0.6, label="genuine/legit", density=True)
    plt.hist(scores[y_true == 1], bins=50, alpha=0.6, label="impostor/fraud", density=True)
    plt.xlabel("score"); plt.ylabel("density")
    plt.title(f"Score distribution — {title}"); plt.legend()
    plt.tight_layout(); plt.savefig(out, dpi=120); plt.close()
