.PHONY: demo up down logs build restart setup install migrate seed \
        fabric-setup fabric-up fabric-down \
        dev-backend dev-frontend dev-ml train-fraud \
        lint test clean

# ── One-command judge bring-up (stack + Fabric + seed + smoke test) ──
demo:
	./start.sh

# ── Docker ──────────────────────────────────────────────────────────
up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build --no-cache

restart:
	docker compose restart

# ── Setup ───────────────────────────────────────────────────────────
setup: cp-env install
	@echo "✓ Setup complete. Run 'make up' to start services."

cp-env:
	@if [ ! -f .env ]; then cp .env.example .env && echo "✓ Created .env from .env.example — fill in secrets before running."; fi

install:
	cd frontend && npm install
	cd sdk && npm install
	cd backend && pip install -r requirements.txt
	cd ml && pip install -r requirements.txt

migrate:
	docker compose exec postgres psql -U citadel -d citadel \
		-f /docker-entrypoint-initdb.d/001_initial_schema.sql

seed:
	docker compose exec postgres psql -U citadel -d citadel \
		-f /docker-entrypoint-initdb.d/002_seed.sql

# ── ML model regeneration ────────────────────────────────────────────
# Regenerate the transaction-fraud weights (XGBoost + COPOD) from the PaySim
# CSV in ml/data/. The docker ml service also auto-runs this on first boot if
# ml/models/copod_anomaly.pkl is missing, so this is only needed for a
# host-side refresh.
train-fraud:
	cd ml && python -m src.train_fraud

# ── Hyperledger Fabric ───────────────────────────────────────────────
fabric-setup:
	cd blockchain && bash scripts/setup.sh

fabric-up:
	cd blockchain && bash scripts/start.sh

fabric-down:
	cd blockchain && bash scripts/stop.sh

# ── Local Dev (without Docker) ───────────────────────────────────────
dev-backend:
	cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

dev-ml:
	cd ml && uvicorn main:app --reload --host 0.0.0.0 --port 8001

# ── Quality ──────────────────────────────────────────────────────────
lint:
	cd backend && ruff check .
	cd ml && ruff check .
	cd frontend && npm run lint

test:
	cd backend && pytest tests/ -v
	cd ml && pytest tests/ -v

# ── Cleanup ──────────────────────────────────────────────────────────
clean:
	docker compose down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
