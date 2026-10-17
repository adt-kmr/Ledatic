FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY . .

RUN sed -i 's/\r$//' scripts/ensure_models.sh && chmod +x scripts/ensure_models.sh

EXPOSE 8001

# Entrypoint regenerates the gitignored COPOD model on first boot if it's
# missing (judges on a fresh clone), then starts uvicorn. On machines that
# already have ml/models/copod_anomaly.pkl it skips training and starts instantly.
CMD ["scripts/ensure_models.sh"]
