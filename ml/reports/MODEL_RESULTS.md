# Citadel — Model Results (measured on real datasets)

**Team Incognito** · Derby Hackathon 2026

_Last updated: 2026-06-29_

Every number below was produced by evaluating the **deployed weights in `ml/models/`** on real held-out data, with honest evaluation protocols (open-set splits, temporal splits, group K-fold). No paper benchmarks are claimed as our own. Reproduction commands are at the bottom.

---

## Summary — all 4 trained models + 1 LLM agent

| Model | Type | Dataset | Eval protocol | Measured | Status |
|-------|------|---------|---------------|----------|--------|
| **BehaveFormer + Siamese** (keystroke) | Transformer + metric | Aalto (10k users) | Open-set (1500 disjoint test users) | **ROC-AUC 0.9441 · EER 12.3% · TAR@FAR1% 0.684** | trained (Colab GPU, deployed 2026-06-24) |
| **CNN-LSTM** (mouse) | CNN + LSTM | Balabit | 5-fold GroupKFold by session | **ROC-AUC 0.7003** | trained (Colab GPU, deployed 2026-06-24) |
| **XGBoost** (fraud) | Gradient boosting | PaySim (TRANSFER+CASH_OUT) | Temporal split | **ROC-AUC 0.868 · PR-AUC 0.392 · F1 0.439** | trained (local CPU, 2026-06-29) |
| **COPOD** (zero-day anomaly) | Unsupervised anomaly | PaySim | Temporal split | **ROC-AUC 0.815 · PR-AUC 0.306** | trained (local CPU, 2026-06-29) |
| **Groq LLaMA 3.3-70b** (investigation agent) | LLM via Groq API | n/a (no training) | n/a | ~2–4s latency, rule-based fallback | integrated |

All 4 ML weights are present in `ml/models/` and are loaded by the live `/score` and `/score-transactions` endpoints.

---

## Pipeline A — Keystroke verification (BehaveFormer + Siamese) [measured]

**Setup:** curated 10,000-user subset (quality-filtered from Aalto 136M). **Open-set split** — Train 7,000 / Val 1,500 / **Test 1,500 disjoint users** (test users never seen in training; the honest biometric protocol). Triplet loss; 3-shot enrollment (3 sessions = passport); genuine vs impostor pairs scored by cosine similarity.

**Deployed weights:** `ml/models/behaveformer_finetuned.pth` + `ml/models/siamese_head.pth`.

| Metric | Value |
|--------|-------|
| ROC-AUC | **0.9441** |
| EER | **0.1231** (12.3%) |
| TAR @ FAR=1% | 0.6841 |
| Test users | 1500 (disjoint) |
| Pairs | 25,500 (18,000 genuine / 7,500 impostor) |

**Live verified:** genuine-user similarity ~0.999, impostor (correct password, wrong person) ~0.74. Passports persist in `ml/models/passports.json`.

**EER note:** The proposal cites "EER 1.80–2.95%" from the IEEE TBIOM 2024 paper — this is the BehaveFormer's EER on the **closed-set** benchmark (same users in train and test). Our **open-set** evaluation (1,500 disjoint test users never seen in training) yields EER 12.3%, which is the honest biometric protocol. The ROC-AUC of 0.944 is consistent across both settings. The 1.80–2.95% figure represents the architectural ceiling; our measured 12.3% reflects realistic generalization to unseen users.

---

## Pipeline B — Mouse anomaly (CNN-LSTM) [measured]

**Setup:** Balabit — 26,239 windows from 881 sessions (legit 15,347 / illegal 10,892). **5-fold GroupKFold by session** (windows of one session never straddle folds — no leakage).

**Deployed weights:** `ml/models/cnn_lstm.pth`.

| Metric | Value |
|--------|-------|
| ROC-AUC (5-fold CV mean) | **0.70** |
| ROC-AUC (in-sample, deployed weight) | 0.7003 |

**Honest caveat:** this is the weakest model. It contributes 10% to the composite as a supporting signal — not a primary detector. The pre-login guard caps its output at 250 (always APPROVE) before 5 keystrokes to avoid false-blocks during page load.

---

## Pipeline C — Transaction fraud (PaySim) [measured]

**Setup:** filtered to TRANSFER + CASH_OUT (all fraud lives there) → **temporal split** by `step` (train on past hours, test on future) — no leakage. 454,308 train (812 fraud) / 5,916 test (160 fraud). `dest_indegree` (mule signal) learned from train only. XGBoost with `scale_pos_weight ≈ 558` for the class imbalance.

**Deployed weights:** `ml/models/xgboost_fraud.json` + `ml/models/copod_anomaly.pkl` (+ `fraud_scaler.pkl`).

**Features (13, all real-UPI-transferable):** `log_amount, hour, is_transfer, dest_indegree, payer_outdeg, amount_vs_payer_avg, recipient_novelty, is_round_amt, is_odd_hour, payee_unique_senders, amount_zscore_payer, payer_payee_concentration, log_dest_indegree`.

| Model | ROC-AUC | PR-AUC | Precision | Recall | F1 | Confusion (test, 5916 / 160 fraud) |
|-------|---------|--------|-----------|--------|-----|------------------------------------|
| XGBoost | 0.8681 | 0.3917 | 0.517 | 0.381 | 0.439 | TN 5699 · FP 57 · FN 99 · TP 61 |
| COPOD (unsupervised) | 0.8148 | 0.3065 | 0.483 | 0.181 | 0.264 | TN 5725 · FP 31 · FN 131 · TP 29 |

**Top SHAP features:** `hour`, `dest_indegree`, `log_amount`, `amount_vs_payer_avg`, `is_transfer` → satisfies RBI FREE-AI §4.2 explainability (exposed via `GET /api/auth/explain/{id}`).

**Honesty note:** the old XGBoost model that scored ROC-AUC 1.000 on PaySim was **removed** — it relied on balance-reconciliation features (`errorBalanceOrig`, `oldbalanceOrg`, etc.) that don't exist in real UPI logs and made synthetic fraud near-deterministically separable. The deployed 0.868 model uses **only real-UPI-transferable features**, so it runs unchanged on real UPI data. PR-AUC 0.39 reflects the real class imbalance (fraud is rare) — present this as "sound on bank-format transaction data," not "100% fraud detection."

**Single-transaction gate (`/score-transaction`) is indicative only** — an absolute threshold doesn't transfer from synthetic PaySim to real UPI, and a lone transaction has no account context. Use **batch ranking** (`/score-transactions`) for demo decisions.

Plots: `reports/plots/fraud_roc.png`, `fraud_pr.png`, `fraud_confusion.png`, `fraud_score_dist.png`.

---

## Pipeline D — Fraud investigation agent (Groq LLaMA 3.3-70b) [integrated]

**Not a trained model** — no training. A LangChain agent gathers evidence from 4 sources in parallel (session DB, login history, IMEI mule flags, CAMARA telecom data) and sends a structured prompt to `llama-3.3-70b-versatile` via Groq for a human-readable investigation report on HARD BLOCK.

- **Latency:** ~2–4s (down from ~28s on the previous MiMo implementation).
- **Fallback:** Groq → rule-based report from DB data alone. Never returns an empty report.

---

## What is NOT a trained model (honest reporting)

- **Coercion detection** — rule-based, not learned. `coercion_probability` from screen-share (+0.30), clipboard paste (+0.20), tab hidden (+0.10), keystroke hesitation >3σ (+0.20), CAMARA SIM swap (+0.15). ≥0.65 forces STEP-UP regardless of ML score.
- **Touch biometrics** — touch pressure/size/taps are **captured as features** feeding the risk engine, but there is no standalone trained touch model (no public dataset at scale). Do not claim "touch biometrics model."

---

## Datasets & splits

| Dataset | Raw | Used (curated) | Split | In repo? |
|---------|-----|----------------|-------|----------|
| Aalto 136M keystroke | 168,595 users / 18GB | 10,000 quality users → `keystroke_subset.npz` (75MB) | open-set by user | gitignored |
| Balabit mouse | 10+10 users | 881 sessions → `mouse_subset.npz` (4MB) | 5-fold GroupKFold | gitignored |
| PaySim | 6.36M txns | 454,308 train / 5,916 test (TRANSFER+CASH_OUT) | temporal by step | gitignored |

All raw + curated data is gitignored; weights are regenerable from the scripts.

---

## Reproduce

```bash
# Pipeline C — fraud (local CPU, ~30s)
cd ml && python src/train_fraud.py

# Carve curated subsets (local, one-time)
python src/datasets/build_keystroke_subset.py --users 10000
python src/datasets/mouse.py

# Pipelines A & B — quick local sanity check
python src/train_behavioral.py --smoke

# Pipelines A & B — full training (Colab T4 GPU): upload citadel_train.zip, run COLAB_TRAINING.ipynb
# Deployed weights already in ml/models/ were produced this way on 2026-06-24.
```