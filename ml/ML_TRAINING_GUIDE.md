# Citadel — Complete ML Training Guide
**For the AI/ML Lead | Total time: ~4 hours on Colab T4 GPU (free tier)**

This document is the single source of truth for training the 5 models that power Citadel's behavioral authentication. Read it front-to-back before starting — every section answers a question that will come up while you train.

---

## TL;DR — What You're Doing

You will train **3 deep-learning models** on Google Colab and drop their weight files into `ml/models/`. The other **2 classical models** (XGBoost, Isolation Forest) train automatically every time the `ml` service starts — you only need to retrain them if you have a better labelled fraud dataset.

| # | Model | Where it trains | Output file | Time |
|---|---|---|---|---|
| 1 | BehaveFormer (Transformer) | Colab T4 | `ml/models/behaveformer_finetuned.pth` | ~2 hrs |
| 2 | Siamese Head | Colab T4 | `ml/models/siamese_head.pth` | ~1 hr |
| 3 | CNN-LSTM | Colab T4 (or CPU) | `ml/models/cnn_lstm.pth` | ~30 min |
| 4 | XGBoost | Auto on backend startup | — | — |
| 5 | Isolation Forest | Auto on backend startup | — | — |

After training, drop the 3 `.pth` files into `ml/models/` then `docker compose restart ml`. Done.

---

## Part 1 — The 5 Models

### Model 1: BehaveFormer (STDAT Transformer)

**What it does:** Builds a unique 128-dim "behavioral fingerprint" of how *you* type and tap. Same person → same fingerprint. Impostor → different fingerprint.

**Why it exists:** Passwords, OTPs, and even biometrics can be stolen. *How* you type cannot be copied easily. BehaveFormer turns 32 keystrokes into a vector that's as personal as a signature.

**Source file:** `ml/src/behaveformer.py`

**Architecture (exactly as wired):**

```
Input: (batch, 32, 6) keystroke feature sequence
        │
        ├──> Linear(6 → 128) + Positional Embedding(512, 128)
        │           │
        │           v
        │   TransformerEncoder (2 layers, 4 heads, d_model=128, FFN=512)
        │           │
        │           v
        │     mean-pool over time  ──> t_emb (128-dim)
        │
        ├──> concat([x.mean(time), x.std(time)]) (12-dim)
        │           │
        │           v
        │   Linear(12 → 128) → GELU → LayerNorm  ──> s_emb (128-dim)
        │
        v
  Fusion: concat(t_emb, s_emb) → Linear(256 → 128) → GELU → LayerNorm
        │
        v
  L2 normalize ──> 128-dim embedding
```

**6 input features per keystroke** (built by `feature_engine.build_keystroke_sequence()`):
1. `dwell_time` (ms)  — how long the key was pressed
2. `flight_time` (ms) — gap to the next keystroke
3. `key_code_norm`    — normalized key code
4. `is_letter`        — 1 if alphabet key
5. `is_digit`         — 1 if numeric key
6. `is_special`       — 1 if special char (punctuation, modifier)

**Training objective:** Triplet loss with margin 0.2.
For each user: pick an anchor session, a positive (same user) session, and a negative (different user) session. Push anchor closer to positive than negative by at least the margin.

```
L_triplet = max(0, d(anchor, positive) − d(anchor, negative) + margin)
```

**Reference paper:** *"BehaveFormer: A Framework with Spatio-Temporal Dual Attention Transformers for IMU-enhanced Keystroke Dynamics"* — IEEE TBIOM 2024. EER reported: 1.80–2.95% on Aalto Mobile Keystroke DB. GitHub: search for `behaveformer` on github.com — the official PyTorch implementation is public.

**What to do for training:** Cell 4 of `ml/COLAB_TRAINING.ipynb`. 20 epochs, Adam (lr=1e-4), batch size 64.

---

### Model 2: Siamese Head

**What it does:** Compares two BehaveFormer embeddings and outputs a similarity score in [0, 1]. 1 = identical user, 0 = different person.

**Why it exists:** A 128-dim embedding alone doesn't tell you "is this the same user?" You need a *metric learning* layer that projects embeddings into a space where simple cosine similarity gives a usable yes/no answer.

**Source file:** `ml/src/siamese.py`

**Architecture (exactly as wired):**

```
Input: 128-dim BehaveFormer embedding
        │
        v
  Linear(128 → 64) → GELU → LayerNorm
        │
        v
  L2 normalize ──> 64-dim projected vector
```

For inference, two projected vectors are compared with cosine similarity, then rescaled from [-1, 1] to [0, 1].

**Training objective:** Contrastive loss on pairs.
```
L_contrastive = y · d(a, b)² + (1 − y) · max(0, margin − d(a, b))²
```
where `y=1` means same user, `y=0` means different user. Use margin 0.5.

**3-shot enrollment logic (already implemented):** When a user signs up, the system stores 3 BehaveFormer embeddings (their first 3 logins) and averages them into a "passport embedding". From login #4 onward, every new session's embedding is compared via the Siamese head against this passport. Drop in similarity → score floor rises → STEP_UP or HARD_BLOCK.

**What to do for training:** Cell 5 of `ml/COLAB_TRAINING.ipynb`. 10 epochs, Adam (lr=1e-4), batch size 128. The encoder from Model 1 is frozen — you only train the small projection head.

---

### Model 3: CNN-LSTM Session Encoder

**What it does:** Detects *behavioral drift within a single session*. Catches mid-session takeovers — e.g., legitimate user logs in, attacker takes over the screen via remote-control mid-way through.

**Why it exists:** Models 1+2 verify identity at the *start* of a session. They miss attacks that happen *during* the session. CNN-LSTM watches the temporal pattern of mouse movement and flags anomalies.

**Source file:** `ml/src/cnn_lstm.py`

**Architecture (exactly as wired):**

```
Input: (batch, seq_len, 4) mouse trajectory
        │
        v  (transpose to channels-first for Conv1d)
  Conv1d(4 → 32, kernel=3, pad=1) → GELU
  Conv1d(32 → 32, kernel=3, pad=1) → GELU
        │
        v  (transpose back to seq-first)
  LSTM(input=32, hidden=64, 1 layer, batch_first=True)
        │
        v  (take last hidden state)
  Linear(64 → 32) → GELU → Linear(32 → 1) → Sigmoid
        │
        v
  drift score in [0, 1]
```

**4 input features per mouse event** (built by `feature_engine.build_mouse_sequence()`):
1. `dx` — change in x
2. `dy` — change in y
3. `velocity` — pixels per ms
4. `acceleration` — change in velocity

**Training objective:** Binary cross-entropy.
- Label 0 = normal session (one continuous human user)
- Label 1 = drift session (mid-session change of operator, simulated by stitching two users' trajectories together)

**What to do for training:** Cell 6 of `ml/COLAB_TRAINING.ipynb`. 15 epochs, Adam (lr=5e-4), batch size 32. Lightweight — works fine on CPU if GPU isn't available.

---

### Model 4: XGBoost Risk Scorer (auto-trains)

**What it does:** The *final* fraud classifier. Eats 40 engineered features + outputs from Models 1, 2, 3 → emits a risk score 0–1000 plus SHAP explanations.

**Source file:** `ml/src/risk_scorer.py`

**Architecture:**
- `xgb.XGBClassifier(n_estimators=200, max_depth=5, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8)`
- Wrapped with `shap.TreeExplainer` for explainability (RBI FREE-AI compliance)

**Trains automatically** at backend startup on synthetic labelled sessions. Re-trains every restart. The `train()` method is in `risk_scorer.py:235`.

**When to retrain offline (optional advanced step):** If you find or build a real labelled banking-fraud dataset (e.g., IEEE-CIS Fraud Detection on Kaggle, or PSB-supplied data), you can:
1. Replace `_generate_synthetic_sessions()` with a real-data loader
2. Run `RiskScorer().train()` locally
3. Pickle the resulting `xgb` and `scaler` to `ml/models/xgb_risk_scorer.pkl` and `ml/models/scaler.pkl`
4. Modify `train()` to skip retraining if those files exist

This is **not required** for the demo — synthetic data gives believable scores. List it as a roadmap item.

---

### Model 5: Isolation Forest (auto-trains)

**What it does:** Catches *zero-day* / novel attack patterns that XGBoost has never seen labels for. Runs in parallel on the same feature vector.

**Source file:** `ml/src/risk_scorer.py` (lines 229–231)

**Architecture:** `IsolationForest(n_estimators=100, contamination=0.2)`

**Training:** Fits on the *normal* (label=0) sessions only. Outputs an anomaly score that boosts the composite risk score by up to 20%.

**Trains automatically** on backend startup. No action needed from you.

---

## Part 2 — How the 5 Models Chain Together

```
                  ┌──────────────────────────────────────────────────────────┐
                  │              ml/src/pipeline.py — MLPipeline             │
                  └──────────────────────────────────────────────────────────┘

  keystroke events  ────>  feature_engine.build_keystroke_sequence()  ──>  (32, 6) array
                                                                            │
                                                                            v
                                                                   ┌─── BehaveFormer ───┐  (Model 1)
                                                                   │   128-dim embedding │
                                                                   └────────┬───────────┘
                                                                            │
                                                          ┌─────────────────┴────────────┐
                                                          v                              v
                                          ┌─── Siamese Head ──────┐         ┌── feature 40-vec  ──────────┐
                                          │  similarity to passport │       │  (mean dwell, std flight,  │
                                          │  in [0, 1]              │ ─┐    │   touch pressure, mouse    │
                                          └─────────────────────────┘  │    │   velocity, screen-share,  │
                                                                       │    │   clipboard paste, ...)    │
  mouse events  ──>  build_mouse_sequence()                            │    └────────┬───────────────────┘
                              │                                        │             │
                              v                                        ├─────────────┤
                    ┌─── CNN-LSTM ───┐ (Model 3)                       │             │
                    │ drift score 0-1│                                 │             │
                    └────────┬───────┘                                 │             │
                             │                                         │             │
                             └────────┬────────────────────────────────┘             │
                                      │                                              v
                                      v                                  ┌── XGBoost (Model 4) ─┐
                                      └─────────────────────────────────>│   fraud_prob 0-1     │
                                                                          │   + SHAP top-5      │
                                                                          └────────┬─────────────┘
                                                                                   │
  feature 40-vec  ──────────────────────────────────────────────────────────────> IsolationForest (Model 5)
                                                                                   │   anomaly score
                                                                                   v
                                                       Composite formula (risk_scorer.py:274):
                                                       risk_score = (
                                                           xgb_fraud_prob   * 0.55 +
                                                           iso_anomaly      * 0.20 +
                                                           siamese_penalty  * 0.15 +
                                                           drift_score      * 0.10
                                                       ) * 1000
                                                                                   │
                                                                                   v
                                                       Decision thresholds (auth.py):
                                                          0–299   → APPROVE
                                                          300–599 → STEP_UP
                                                          600+    → HARD_BLOCK
```

---

## Part 3 — Datasets

We use **3 public datasets** for training. All are free for academic / hackathon use.

### Primary Dataset: Aalto Mobile Keystroke Database
- **What:** ~260K typing sessions from ~37,000 users typing on smartphones in natural settings.
- **Use for:** BehaveFormer (Model 1) and Siamese Head (Model 2).
- **Format:** Each session is a CSV of (key_code, press_time_ms, release_time_ms).
- **Why this one:** Massive scale, real-world distribution, mobile-banking-relevant (small screens, thumb typing).
- **Where to get it:** Aalto University publishes it via `https://userinterfaces.aalto.fi/typing37k/` (or search "Aalto Mobile Keystroke Dataset" — direct link sometimes rotates).
- **Size:** ~260 MB compressed. Download via `wget` inside the Colab notebook.
- **Fallback:** If the link is down, Cell 2 of the Colab notebook auto-generates synthetic keystroke sequences with controlled inter-user variance. The architecture still trains end-to-end, results just won't be paper-quality.

### Secondary Dataset: HuMIdb (Human Mobile Interaction Database)
- **What:** 600 users, IMU + touch + keystroke data on Android phones.
- **Use for:** CNN-LSTM (Model 3) — provides mouse/touch trajectory data needed for drift detection.
- **Where:** `https://github.com/BiDAlab/HuMIdb` (UAM Madrid).
- **Size:** ~3 GB. Filter to only the touch/mouse channels for our use case.

### Tertiary Dataset: HMOG (Hand Movement, Orientation, and Grasp)
- **What:** 100 users × 4–10 sessions each, motion sensors + tap data.
- **Use for:** Augmenting the Siamese training pairs (more diverse negatives).
- **Where:** `https://www.cs.wm.edu/~qyang/hmog.html`

### Synthetic Augmentation (already in the notebook)
- The Colab notebook has a `generate_synthetic_data()` function that creates labelled positive/negative pairs by perturbing real sequences. This gives a 5–10× data multiplier and reduces overfitting on small datasets.

**Recommendation for the hackathon:** Use Aalto for Models 1 & 2, and use synthetic mouse trajectories from `feature_engine` for Model 3. HuMIdb is large and slow to download — only use it if you have extra time.

---

## Part 4 — Training Procedure (Step-by-Step)

### Step 1 — Open the Notebook in Colab

1. Go to `https://colab.research.google.com`
2. `File → Upload notebook` → select `ml/COLAB_TRAINING.ipynb` from the repo
3. Sign in with your Google account

### Step 2 — Enable GPU

1. `Runtime → Change runtime type`
2. **Hardware accelerator:** `T4 GPU` (free tier — no Colab Pro needed)
3. Click `Save`

Verify GPU is active by running the first cell — you should see `cuda` in the output, not `cpu`.

### Step 3 — Run Cells in Order

The notebook has 7 cells. Run them top-to-bottom, waiting for each to finish before starting the next.

| Cell | Purpose | Time | What to watch for |
|---|---|---|---|
| 1 | Install dependencies (torch, einops, xgboost, shap) | ~2 min | `Successfully installed` messages |
| 2 | Download Aalto dataset (or fall back to synthetic) | ~3 min | `Downloaded N sessions` |
| 3 | Build `(N, 32, 6)` feature tensors from raw sessions | <1 min | `Train shape: (..., 32, 6)` |
| 4 | **Train BehaveFormer** — 20 epochs, triplet loss | **~2 hrs** | Loss should drop from ~0.4 to <0.1 |
| 5 | **Train Siamese Head** — 10 epochs, contrastive loss | **~1 hr** | Validation accuracy should hit ~92% |
| 6 | **Train CNN-LSTM** — 15 epochs, BCE loss | **~30 min** | ROC-AUC should hit ~0.85 |
| 7 | Bundle all 3 `.pth` files and trigger browser download | <1 min | 3 files auto-download to your machine |

**Important:** Do not close the Colab tab during training. Free tier disconnects after ~90 minutes of inactivity. Keep the tab visible and interact every 30 minutes (scroll, click anywhere — Colab tracks tab activity).

If Cell 4 (longest) gets disconnected, the notebook has a checkpointing block — restart the cell and it'll resume from the last saved epoch.

### Step 4 — Drop Weights Into the Project

After Cell 7 completes, your browser will download:
- `behaveformer_finetuned.pth` (~5 MB)
- `siamese_head.pth` (~100 KB)
- `cnn_lstm.pth` (~500 KB)

Move all three into `ml/models/` in your local repo:

```bash
mv ~/Downloads/behaveformer_finetuned.pth "Citadel/ml/models/"
mv ~/Downloads/siamese_head.pth           "Citadel/ml/models/"
mv ~/Downloads/cnn_lstm.pth               "Citadel/ml/models/"
```

### Step 5 — Reload the ML Service

```bash
cd "Citadel"
docker compose restart ml
docker logs citadel-ml-1 --tail 30
```

Look for these log lines:
```
Loaded BehaveFormer weights from /app/models/behaveformer_finetuned.pth
Loaded Siamese head weights from /app/models/siamese_head.pth
Loaded CNN-LSTM weights from /app/models/cnn_lstm.pth
```

If any file is missing or fails to load, the service silently falls back to random-init weights — so **check the logs explicitly**.

### Step 6 — Verify

Run the demo rehearsal script:

```bash
bash blockchain/scripts/demo_reset.sh
/tmp/demo_final.sh   # or recreate it from the project docs
```

Scenario 4 (behavioral drift) should now return `HARD_BLOCK` with a score driven by the Siamese similarity dropping, not by progressive penalty stacking. The `reason` field should reference embedding distance.

---

## Part 5 — Research Background (For the Pitch)

If a judge asks "why these architectures, why not just one model?" — here's the defensible answer.

### Why BehaveFormer over a simple LSTM
Keystroke dynamics have two information sources: **temporal patterns** (how fast you type) and **spatial patterns** (how consistent each finger is). LSTMs only see the temporal axis. BehaveFormer's dual-path design — Transformer over time + feature-stat path over space — captures both. EER drops from ~5% (LSTM) to ~2% (BehaveFormer) on Aalto. Cited paper achieves SOTA on TBIOM 2024.

### Why Siamese + 3-shot enrollment
Banking has a brutal cold-start problem — users don't enrol behavior the way they enrol fingerprints. Siamese networks with triplet loss enable **few-shot learning**: 3 sessions are enough to build a usable passport. Compare this to traditional ML which needs 100+ labelled examples per user.

### Why CNN-LSTM for drift
CNNs catch local motor patterns (kernel size 3 = 3 consecutive mouse events). LSTMs aggregate those local patterns into a session-wide signal. Together they detect mid-session changes — which is exactly the threat model for screen-sharing scams.

### Why XGBoost + Isolation Forest together
XGBoost is the *known fraud* classifier — it learns from labelled fraud examples. Isolation Forest is the *unknown fraud* detector — it flags anything that doesn't look like normal traffic. Banks face both threat types: classical phishing (known) and novel social engineering (unknown). Two models, two threat classes.

### Why SHAP
RBI FREE-AI (April 2026 deadline) requires *every* AI-driven banking decision to be explainable. SHAP gives per-feature contributions to each prediction — judges can literally see "this keystroke dwell time pushed the score up by 87 points." Compliance, audit-ready.

---

## Part 6 — Troubleshooting

### "CUDA out of memory" during BehaveFormer training
- Reduce batch size from 64 → 32 in Cell 4
- Reduce seq_len from 32 → 16 (slight accuracy loss, ~2× speedup)

### Colab disconnects mid-training
- The notebook saves a checkpoint after each epoch (`epoch_*.pth` in `/content/`)
- Re-run the cell — it'll detect and resume from the last checkpoint

### `.pth` files load but Scenario 4 still returns APPROVE
- Run `docker logs citadel-ml-1` and search for `Loaded`
- If you see `Random init` instead, the path is wrong — check the file is in `/app/models/` inside the container (which maps to `ml/models/` locally)
- Stop the entire stack and re-run `docker compose up` to force a clean image rebuild

### Siamese validation accuracy plateaus at ~50%
- Your triplet sampler is producing too-easy negatives — switch to *semi-hard* negative mining in Cell 5
- Or train BehaveFormer longer (Cell 4) — Siamese accuracy is bounded by the quality of the upstream embeddings

### XGBoost SHAP values look random
- The synthetic training data has weak feature-target correlations — that's expected
- For the demo this is fine because the *real* signal flow is through BehaveFormer/Siamese, not XGBoost
- For production: replace `_generate_synthetic_sessions()` with real labelled data

---

## Part 7 — What "Done" Looks Like

You're done when **all four** of these are true:

- [ ] All 3 `.pth` files exist in `ml/models/`
- [ ] `docker logs citadel-ml-1` shows `Loaded ... weights` for all three
- [ ] Demo scenario 4 (behavioral drift) returns `HARD_BLOCK` with a reason containing "similarity" or "embedding"
- [ ] No "Random init" warnings in the ML service logs

When that's the case, commit and push the weight files:

```bash
git add ml/models/*.pth
git commit -m "Add trained model weights — BehaveFormer + Siamese + CNN-LSTM"
git push origin main
```

**Note:** The `.pth` files are not in `.gitignore` — they're meant to be committed so teammates and judges can run the project without re-training.

---

## Part 8 — Quick Reference Card

| What | Where |
|---|---|
| Architecture code | `ml/src/{behaveformer,siamese,cnn_lstm,risk_scorer}.py` |
| Training notebook | `ml/COLAB_TRAINING.ipynb` |
| Output directory | `ml/models/` |
| Inference pipeline | `ml/src/pipeline.py` |
| Feature engineering | `ml/src/feature_engine.py` |
| Decision thresholds | `backend/app/api/auth.py` lines 362–412 |
| Demo verification script | `/tmp/demo_final.sh` (regenerate from session 2 of the project chat) |
| Demo reset | `blockchain/scripts/demo_reset.sh` |

Ping the team when weights are committed. The fullstack lead will re-test all 4 scenarios with the trained models and capture a demo screen-recording as backup.

Good luck.
