# Citadel — ML Training Plan (Historical — training is complete)

> **Status:** All models below have since been trained/fine-tuned and their
> weights are checked into `ml/models/`. Measured eval metrics are in
> `ml/reports/MODEL_RESULTS.md` (matches the numbers published in the root
> README). This document is kept for the dataset links and training recipe,
> not as a statement of current model state — see "Current State" below,
> which has been updated to reflect reality.

## Datasets to Download

| Dataset | Contents | Size | Link |
|---------|----------|------|------|
| Aalto Mobile Keystroke DB | Touch + keystroke dynamics, free | ~260MB | https://userinterfaces.aalto.fi/typing/ |
| HuMIdb | IMU + touch, 600 users | ~2GB | https://www.mdpi.com/1424-8220/22/1/366 |
| HMOG DB | Continuous mobile auth, motion sensors | ~1.5GB | https://hmog-dataset.github.io/hmog/ |

---

## Models to Train (Google Colab — GPU required)

### 1. STDAT BehaveFormer (fine-tune only)
- **Do NOT train from scratch** — load pre-trained weights from IEEE Q1 TBIOM 2024 GitHub
- Fine-tune on Aalto DB keystroke sequences
- Input: (batch, seq_len, 6) keystroke features → Output: 128-dim L2-normalized embedding
- Export: `behaveformer_finetuned.pth` → drop into `ml/models/`
- Estimated time: 1-2 hrs on Colab T4 GPU

### 2. Siamese Network
- Train from scratch on Aalto DB using triplet loss
- Triplets: (user_session_A, user_session_B, different_user_session)
- Export: `siamese_head.pth` → drop into `ml/models/`
- Estimated time: 30-60 mins on Colab T4

### 3. CNN-LSTM Session Encoder
- Train on HMOG mouse/scroll sequences
- Small model — can run on Colab free tier CPU
- Export: `cnn_lstm.pth` → drop into `ml/models/`
- Estimated time: 20-30 mins

### 4. XGBoost + IsolationForest
- Already trains at startup on synthetic data (~500ms)
- No Colab needed
- When real data available: retrain on Aalto features → export `risk_scorer.pkl`

---

## How to Load Weights (already wired in code)

```python
# ml/src/behaveformer.py — BehaveFormerEncoder.__init__
model_path = Path("/app/models/behaveformer_finetuned.pth")
if model_path.exists():
    self.model.load_state_dict(torch.load(model_path, map_location="cpu"))
    # else: random weights (current state)

# ml/src/siamese.py — SiameseNetwork.__init__
model_path = Path("/app/models/siamese_head.pth")
if model_path.exists():
    self.load_state_dict(torch.load(model_path, map_location="cpu"))
```

Drop trained `.pth` files into `ml/models/` volume — picked up on next restart, no code changes needed.

---

## Current State (trained weights present)

| Model | Current behavior |
|-------|-----------------|
| BehaveFormer | Fine-tuned weights loaded from `ml/models/behaveformer_finetuned.pth` — ROC-AUC 0.944 (open-set), see `ml/reports/MODEL_RESULTS.md` |
| Siamese | Trained weights loaded from `ml/models/siamese_head.pth` — EER 12.3% (open-set) |
| CNN-LSTM | Trained weights loaded from `ml/models/cnn_lstm.pth` — ROC-AUC 0.70 |
| XGBoost | Trained on PaySim (temporal split) — ROC-AUC 0.868, SHAP works |
| COPOD | Trained on PaySim legit-only — ROC-AUC 0.815 |

**For demo**: all models above give real, calibrated scores and SHAP explanations — nothing is running on random weights.
