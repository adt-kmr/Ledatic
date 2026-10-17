"""
PaySim transaction-fraud dataset loader (Pipeline C).

Source: ml/data/PS_*.csv — 6.36M synthetic mobile-money transactions,
8,213 labelled frauds. Fraud occurs ONLY in TRANSFER + CASH_OUT, so we
filter to those (standard PaySim practice) → ~2.77M rows, 0.296% fraud.

Feature engineering is restricted to signals that ALSO exist in a real UPI
transaction log (amount, time-of-day, transfer type, recipient in-degree).
Balance-reconciliation features (errorBalance*, old/newbalance*) are
deliberately EXCLUDED: they make synthetic PaySim fraud near-perfectly
separable (ROC-AUC ~1.0) but DO NOT exist in real UPI data, so a model that
relies on them cannot be deployed. Dropping them gives an honest, transferable
model that runs unchanged on the bank's real UPI transactions.

  - dest_indegree : how many transactions land on the recipient account,
    computed FROM TRAIN ONLY (leak-free) — the money-mule indicator

Split is TEMPORAL (by `step`, an hour counter 1..743) to avoid leakage and
mimic real deployment: train on the past, test on the future.
"""
from __future__ import annotations

import glob
import logging
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
FRAUD_TYPES = ("TRANSFER", "CASH_OUT")

FEATURE_NAMES = [
    "log_amount",          # log1p(amount) — tames the heavy tail
    "hour",                # time-of-day
    "is_transfer",         # P2P transfer vs cash-out
    "dest_indegree",       # mule signal: txns landing on recipient
    "payer_outdeg",        # sender fan-out: one account → many payees
    "amount_vs_payer_avg", # this txn vs the sender's usual amount
    "recipient_novelty",   # first time this sender→recipient pair is seen
    "is_round_amt",        # round-number amount (Rs ×500)
    "is_odd_hour",         # late-night / early-morning
    # ── extended (measured: lifts unsupervised COPOD ~0.73 → ~0.82) ──
    "payee_unique_senders",      # mule fan-in: distinct accounts paying ONE payee
    "amount_zscore_payer",       # how unusual vs this sender's own history
    "payer_payee_concentration", # share of sender's txns going to this payee
    "log_dest_indegree",         # log1p of recipient in-degree (tames skew)
]


def _find_csv() -> Path:
    matches = glob.glob(str(DATA_DIR / "PS_*.csv"))
    if not matches:
        raise FileNotFoundError(f"No PaySim CSV (PS_*.csv) found in {DATA_DIR}")
    return Path(matches[0])


def load_raw(path: Path | None = None) -> pd.DataFrame:
    """Load + filter PaySim to fraud-bearing transaction types."""
    csv = path or _find_csv()
    logger.info("Loading PaySim from %s", csv)
    df = pd.read_csv(csv)
    df = df[df["type"].isin(FRAUD_TYPES)].reset_index(drop=True)
    logger.info("Filtered to %s: %d rows, %d fraud (%.3f%%)",
                FRAUD_TYPES, len(df), int(df.isFraud.sum()), 100 * df.isFraud.mean())
    return df


def _engineer(df: pd.DataFrame, stats: dict | None) -> tuple[pd.DataFrame, dict]:
    """
    Build the feature matrix. `stats` (account frequencies, per-payer means,
    seen sender→recipient pairs) is learned on TRAIN only and reused on
    val/test — leak-free, mirroring real deployment.
    """
    if stats is None:
        g_out = df.groupby("nameOrig")["amount"]
        stats = {
            "dest_indeg":    df["nameDest"].value_counts().to_dict(),
            "payer_outdeg":  df["nameOrig"].value_counts().to_dict(),
            "payer_mean":    g_out.mean().to_dict(),
            "payer_std":     g_out.std().fillna(0).to_dict(),
            "seen_pairs":    set(zip(df["nameOrig"], df["nameDest"])),
            "amt_median":    float(df["amount"].median()),
            "payee_senders": df.groupby("nameDest")["nameOrig"].nunique().to_dict(),
            "pair_cnt":      pd.Series(list(zip(df["nameOrig"], df["nameDest"]))).value_counts().to_dict(),
        }

    out = pd.DataFrame(index=df.index)
    out["log_amount"] = np.log1p(df["amount"])
    out["hour"] = df["step"] % 24
    out["is_transfer"] = (df["type"] == "TRANSFER").astype(np.int8)
    out["dest_indegree"] = df["nameDest"].map(stats["dest_indeg"]).fillna(0).astype(np.float32)
    out["payer_outdeg"] = df["nameOrig"].map(stats["payer_outdeg"]).fillna(0).astype(np.float32)
    pmean = df["nameOrig"].map(stats["payer_mean"]).fillna(stats["amt_median"])
    pstd = df["nameOrig"].map(stats["payer_std"]).fillna(0)
    out["amount_vs_payer_avg"] = (df["amount"] / (pmean + 1.0)).astype(np.float32)
    pairs = list(zip(df["nameOrig"], df["nameDest"]))
    out["recipient_novelty"] = np.array(
        [0 if p in stats["seen_pairs"] else 1 for p in pairs], dtype=np.int8)
    out["is_round_amt"] = ((df["amount"] % 500 == 0) & (df["amount"] > 0)).astype(np.int8)
    out["is_odd_hour"] = ((out["hour"] < 6) | (out["hour"] >= 23)).astype(np.int8)
    # ── extended features ──
    out["payee_unique_senders"] = df["nameDest"].map(stats["payee_senders"]).fillna(0).astype(np.float32)
    out["amount_zscore_payer"] = ((df["amount"] - pmean) / (pstd + 1.0)).astype(np.float32)
    pair_cnt = np.array([stats["pair_cnt"].get(p, 0) for p in pairs], dtype=np.float32)
    out["payer_payee_concentration"] = (pair_cnt / (out["payer_outdeg"].to_numpy() + 1.0)).astype(np.float32)
    out["log_dest_indegree"] = np.log1p(out["dest_indegree"])

    return out[FEATURE_NAMES].astype(np.float32), stats


def temporal_split(
    df: pd.DataFrame, train_frac: float = 0.70, val_frac: float = 0.15
) -> dict[str, np.ndarray]:
    """
    Temporal split by `step`. Features are engineered with dest in-degree
    fit on TRAIN only, then applied to val/test (unseen recipients → 0).

    Returns dict with X_/y_ arrays for train/val/test + feature_names.
    """
    steps = np.sort(df["step"].unique())
    train_cut = steps[int(len(steps) * train_frac)]
    val_cut = steps[int(len(steps) * (train_frac + val_frac))]

    tr = df[df.step <= train_cut]
    va = df[(df.step > train_cut) & (df.step <= val_cut)]
    te = df[df.step > val_cut]

    X_tr, stats = _engineer(tr, None)
    X_va, _ = _engineer(va, stats)
    X_te, _ = _engineer(te, stats)

    logger.info("Temporal split — train %d (%d fraud) | val %d (%d fraud) | test %d (%d fraud)",
                len(tr), int(tr.isFraud.sum()), len(va), int(va.isFraud.sum()),
                len(te), int(te.isFraud.sum()))

    return {
        "X_train": X_tr.to_numpy(), "y_train": tr.isFraud.to_numpy(),
        "X_val": X_va.to_numpy(), "y_val": va.isFraud.to_numpy(),
        "X_test": X_te.to_numpy(), "y_test": te.isFraud.to_numpy(),
        "feature_names": FEATURE_NAMES,
        "train_cut": int(train_cut), "val_cut": int(val_cut),
    }


def load_split(train_frac: float = 0.70, val_frac: float = 0.15) -> dict[str, np.ndarray]:
    """Convenience: load + filter + temporal split in one call."""
    return temporal_split(load_raw(), train_frac, val_frac)
