#!/usr/bin/env bash
# Citadel ML service entrypoint.
#
# Ensures the transaction-fraud models (XGBoost + COPOD) exist before starting
# uvicorn. Behavioral auth (/score) only needs the .pth weights, which ship in
# the repo — so it always works. Transaction fraud (/score-transaction(s))
# needs copod_anomaly.pkl, which is gitignored (212 MB) and therefore may be
# absent on a fresh clone. This script regenerates it on first boot.
#
# Behaviour:
#   - copod_anomaly.pkl already present (bind-mounted from host ml/models)
#       -> skip, start immediately.
#   - missing, but PaySim CSV present (bind-mounted from host ml/data)
#       -> run `python -m src.train_fraud` once (~1-2 min on CPU). The result
#          is written to /app/models, which is the host bind-mount, so it
#          persists across restarts and only trains this one time.
#   - missing and no PaySim CSV
#       -> start anyway; transaction fraud endpoints will return 503 until
#          models are generated. Behavioral auth still works.
set -u

MODELS_DIR="/app/models"
COPOD="${MODELS_DIR}/copod_anomaly.pkl"

if [ -f "$COPOD" ]; then
  echo "[ensure_models] copod_anomaly.pkl present — skipping training."
elif ls /app/data/PS_*.csv >/dev/null 2>&1; then
  echo "[ensure_models] copod_anomaly.pkl missing — regenerating via train_fraud.py"
  echo "[ensure_models] (one-time, ~1-2 min on CPU; persists on the host bind-mount)..."
  if ( cd /app && python -m src.train_fraud ); then
    echo "[ensure_models] training complete — transaction fraud ready."
  else
    echo "[ensure_models] WARNING: train_fraud.py failed — transaction fraud will be"
    echo "[ensure_models] disabled (503). Behavioral auth (/score) still works."
  fi
else
  echo "[ensure_models] No copod_anomaly.pkl and no PaySim CSV in /app/data."
  echo "[ensure_models] Transaction fraud will be disabled (503). To enable, place"
  echo "[ensure_models] PS_*.csv in ml/data/ and run 'make train-fraud'."
  echo "[ensure_models] Behavioral auth (/score) still works."
fi

echo "[ensure_models] starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8001 --reload