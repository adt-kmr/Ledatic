"""
Pipelines A & B — train the 3 deep-learning models on real curated data.

  A. BehaveFormer + Siamese head  → keystroke verification  (EER)
  B. CNN-LSTM                     → mouse session anomaly    (ROC-AUC)

Reuses the exact model classes from src/ so training and inference agree:
  src.behaveformer.BehaveFormer, src.siamese.SiameseHead, src.cnn_lstm.CNNLSTMEncoder

Designed to run on Colab GPU (full) but also CPU-smoke-testable locally:
  python ml/src/train_behavioral.py --smoke         # tiny, ~1 min, verifies it runs
  python ml/src/train_behavioral.py --users 10000   # full Colab run

Outputs → ml/models/{behaveformer_finetuned,siamese_head,cnn_lstm}.pth
          ml/reports/metrics_behavioral.json + plots
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from eval import metrics as M  # noqa: E402
from src.behaveformer import BehaveFormer  # noqa: E402
from src.cnn_lstm import CNNLSTMEncoder  # noqa: E402
from src.datasets import keystroke as KS  # noqa: E402
from src.siamese import SiameseHead  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("train_behavioral")

ML_DIR = Path(__file__).resolve().parents[1]
MODELS = ML_DIR / "models"
REPORTS = ML_DIR / "reports"
PLOTS = REPORTS / "plots"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


# ── Pipeline A: keystroke verification ──────────────────────────────────────

def train_keystroke(users: int, epochs: int, batch: int, steps_per_epoch: int) -> dict:
    data = KS.load_subset()
    seqs, uids = data["sequences"], data["user_ids"]
    n_users = min(users, len(uids))
    split = KS.open_set_split(n_users)
    logger.info("Keystroke — %d users (train %d / val %d / test %d), device=%s",
                n_users, len(split["train"]), len(split["val"]), len(split["test"]), DEVICE)

    behaveformer = BehaveFormer().to(DEVICE)
    head = SiameseHead().to(DEVICE)
    opt = torch.optim.Adam(list(behaveformer.parameters()) + list(head.parameters()), lr=1e-3)
    triplet = nn.TripletMarginLoss(margin=0.3)

    def embed(x: np.ndarray) -> torch.Tensor:
        t = torch.tensor(x, dtype=torch.float32, device=DEVICE)
        return head(behaveformer(t))

    behaveformer.train(); head.train()
    for ep in range(epochs):
        tot = 0.0
        for step in range(steps_per_epoch):
            a, p, n = KS.sample_triplets(seqs, split["train"], batch=batch, seed=ep * 1000 + step)
            opt.zero_grad()
            loss = triplet(embed(a), embed(p), embed(n))
            loss.backward(); opt.step()
            tot += loss.item()
        logger.info("  epoch %d/%d  triplet_loss=%.4f", ep + 1, epochs, tot / steps_per_epoch)

    # ── Eval on disjoint TEST users (open-set EER) ──
    behaveformer.eval(); head.eval()
    test_u = split["test"]
    S = seqs.shape[1]
    with torch.no_grad():
        # embeddings (U_test, S, D) — index by absolute user id
        emb = np.zeros((len(uids), S, 64), dtype=np.float32)
        for u in test_u:
            emb[u] = embed(seqs[u]).cpu().numpy()
    scores, labels = KS.enrollment_pairs(emb, test_u, n_impostor=5)
    report = M.classification_report_dict(labels, scores)
    M.plot_score_dist(labels, -scores, PLOTS / "keystroke_score_dist.png", "BehaveFormer+Siamese (Aalto)")
    M.plot_roc(labels, scores, PLOTS / "keystroke_roc.png", "BehaveFormer+Siamese (Aalto)")
    logger.info("Keystroke TEST (open-set) — EER %.4f | ROC-AUC %.4f | TAR@FAR1%% %.3f",
                report["eer"], report["roc_auc"], report["tar_at_far_1pct"])

    MODELS.mkdir(parents=True, exist_ok=True)
    torch.save(behaveformer.state_dict(), MODELS / "behaveformer_finetuned.pth")
    torch.save(head.state_dict(), MODELS / "siamese_head.pth")
    return {"n_users": n_users, "test_users": len(test_u), **report}


# ── Pipeline B: mouse anomaly ───────────────────────────────────────────────

def train_mouse(epochs: int, batch: int) -> dict:
    from sklearn.model_selection import GroupKFold

    npz = np.load(ML_DIR / "data" / "mouse_subset.npz")
    W, y, groups = npz["windows"], npz["labels"].astype(np.float32), npz["session_ids"]
    logger.info("Mouse — %d windows, %d sessions, legit %d / illegal %d",
                len(W), len(np.unique(groups)), int((y == 0).sum()), int((y == 1).sum()))

    # GroupKFold by session → windows of one session never split across folds
    gkf = GroupKFold(n_splits=5)
    aucs, last_scores, last_y = [], None, None
    for fold, (tr, te) in enumerate(gkf.split(W, y, groups)):
        model = CNNLSTMEncoder().to(DEVICE)
        opt = torch.optim.Adam(model.parameters(), lr=1e-3)
        bce = nn.BCELoss()
        Xtr = torch.tensor(W[tr], device=DEVICE); ytr = torch.tensor(y[tr], device=DEVICE)
        model.train()
        for ep in range(epochs):
            perm = torch.randperm(len(Xtr))
            for i in range(0, len(Xtr), batch):
                idx = perm[i:i + batch]
                opt.zero_grad()
                out = model(Xtr[idx]).squeeze(-1)
                loss = bce(out, ytr[idx])
                loss.backward(); opt.step()
        model.eval()
        with torch.no_grad():
            sc = model(torch.tensor(W[te], device=DEVICE)).squeeze(-1).cpu().numpy()
        from sklearn.metrics import roc_auc_score
        auc = roc_auc_score(y[te], sc)
        aucs.append(auc)
        last_scores, last_y = sc, y[te]
        logger.info("  fold %d ROC-AUC %.4f", fold + 1, auc)

    # Retrain on ALL data for the deployed weight
    model = CNNLSTMEncoder().to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    bce = nn.BCELoss()
    Xall = torch.tensor(W, device=DEVICE); yall = torch.tensor(y, device=DEVICE)
    model.train()
    for ep in range(epochs):
        perm = torch.randperm(len(Xall))
        for i in range(0, len(Xall), batch):
            idx = perm[i:i + batch]
            opt.zero_grad()
            loss = bce(model(Xall[idx]).squeeze(-1), yall[idx])
            loss.backward(); opt.step()
    torch.save(model.state_dict(), MODELS / "cnn_lstm.pth")

    report = M.classification_report_dict(last_y, last_scores, threshold=0.5)
    M.plot_roc(last_y, last_scores, PLOTS / "mouse_roc.png", "CNN-LSTM (Balabit)")
    logger.info("Mouse CV ROC-AUC %.4f ± %.4f", float(np.mean(aucs)), float(np.std(aucs)))
    return {"cv_roc_auc_mean": float(np.mean(aucs)), "cv_roc_auc_std": float(np.std(aucs)),
            "n_folds": len(aucs), **report}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=10000)
    ap.add_argument("--kp-epochs", type=int, default=20)
    ap.add_argument("--mouse-epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--steps-per-epoch", type=int, default=200)
    ap.add_argument("--smoke", action="store_true", help="tiny CPU run to verify the code path")
    args = ap.parse_args()
    if args.smoke:
        args.users, args.kp_epochs, args.mouse_epochs = 60, 1, 1
        args.steps_per_epoch, args.batch = 10, 32

    PLOTS.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    ks = train_keystroke(args.users, args.kp_epochs, args.batch, args.steps_per_epoch)
    mo = train_mouse(args.mouse_epochs, args.batch)

    out = {"keystroke": ks, "mouse": mo, "device": DEVICE,
           "elapsed_sec": round(time.monotonic() - t0, 1), "smoke": args.smoke}
    REPORTS.mkdir(parents=True, exist_ok=True)
    with open(REPORTS / "metrics_behavioral.json", "w") as f:
        json.dump(out, f, indent=2)

    print("\n" + "=" * 60)
    print("PIPELINES A & B — behavioral models" + ("  [SMOKE]" if args.smoke else ""))
    print("=" * 60)
    print(f"  Keystroke (open-set)  EER {ks['eer']:.4f} | ROC-AUC {ks['roc_auc']:.4f}")
    print(f"  Mouse (5-fold CV)     ROC-AUC {mo['cv_roc_auc_mean']:.4f} ± {mo['cv_roc_auc_std']:.4f}")
    print(f"  Weights → {MODELS} | device {DEVICE} | {out['elapsed_sec']}s")


if __name__ == "__main__":
    main()
