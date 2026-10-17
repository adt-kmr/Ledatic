#!/usr/bin/env bash
# ================================================================
# Citadel — One-command demo bring-up.
#
#   ./start.sh        → build + start everything (Docker + Fabric + seed)
#   ./start.sh down   → stop everything
#   ./start.sh clean  → stop + wipe volumes (fresh-slate re-run)
#
# Prereqs: Docker + Docker Compose v2. No manual .env editing needed —
# .env.example has working demo defaults, copied automatically on first run.
#
# When it finishes, open:  http://localhost:5173
#   Demo login: demo / Demo@2026   (or priya / Priya@2026)
# ================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ACTION="${1:-up}"

# ── 0. Ensure .env exists (copy demo defaults if missing) ────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env from .env.example (demo defaults — works as-is)"
fi
# Export vars so demo_setup.sh can read IMEI_HMAC_SECRET
set -a
# shellcheck disable=SC1091
source .env
set +a

down() {
  echo "→ Stopping main stack..."
  docker compose down
  echo "→ Stopping Fabric network..."
  (cd blockchain && bash scripts/stop.sh) 2>/dev/null || true
  echo "✓ Stopped."
}

clean() {
  echo "→ Wiping all containers + volumes (fresh slate)..."
  docker compose down -v --remove-orphans
  (cd blockchain && bash scripts/stop.sh) 2>/dev/null || true
  echo "✓ Clean. Run ./start.sh to bring everything back up."
}

if [ "$ACTION" = "down" ]; then down; exit 0; fi
if [ "$ACTION" = "clean" ]; then clean; exit 0; fi

# ── 1. Build + start the main stack (postgres, redis, ml, camara, backend, frontend) ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Citadel — building + starting stack"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose up -d --build

echo "→ Waiting for backend + postgres to be healthy..."
for i in $(seq 1 40); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "  ✓ backend healthy"; break
  fi
  sleep 2
  [ "$i" -eq 40 ] && { echo "  ✗ backend did not become healthy in 80s — check: docker compose logs backend"; exit 1; }
done

# ── 2. Start Hyperledger Fabric network + deploy chaincodes ──────────
# Non-fatal: if Fabric fails to start, the backend degrades to the Redis-cached
# IMEI baseline + mock ledger feed (the app still works; on-chain badges won't).
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Hyperledger Fabric network"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if (cd blockchain && bash scripts/start.sh); then
  echo "  ✓ Fabric network up + chaincodes deployed"
  FABRIC_OK=1
else
  echo "  ⚠ Fabric start failed — continuing in Redis-fallback mode."
  echo "    On-chain 'Verified by Hyperledger Fabric' badges will not show."
  echo "    To retry: ./start.sh clean && ./start.sh"
  FABRIC_OK=0
fi

# ── 3. Seed on-chain demo baselines (placeholder users) ──────────────
# Non-fatal. The demo user's baseline auto-enrolls on first legit login, so the
# SIM-swap scenario works even if this is skipped. This enriches the ledger tab.
if [ "$FABRIC_OK" = "1" ]; then
  echo ""
  echo "→ Seeding demo IMEI baselines on-chain..."
  if (cd blockchain && bash scripts/demo_setup.sh); then
    echo "  ✓ Demo baselines seeded"
  else
    echo "  ⚠ demo_setup.sh skipped (non-fatal)."
  fi
fi

# ── 4. Smoke test ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  backend  /health  → $(curl -sf http://localhost:8000/health 2>/dev/null || echo 'FAIL')"
echo "  frontend http://localhost:5173 → $(curl -sf -o /dev/null -w 'HTTP %{http_code}' http://localhost:5173 2>/dev/null || echo 'FAIL')"
echo "  ml       :8001    → $(curl -sf -o /dev/null -w 'HTTP %{http_code}' http://localhost:8001/health 2>/dev/null || echo 'checking...')"
if [ "$FABRIC_OK" = "1" ]; then
  echo "  fabric   channel  → $(docker exec cli peer channel getinfo -c citadel-channel 2>/dev/null | head -1 || echo 'n/a')"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Citadel is up."
echo ""
echo "  ➜ Open http://localhost:5173"
echo "    Login: demo / Demo@2026  (or priya / Priya@2026)"
echo "    Run the Live Attack Simulation (3 scenarios) on the login page."
echo ""
echo "  Ledger tab: http://localhost:5173/blockchain  (on-chain IMEI events + ML blocks)"
echo "  Dashboard:  http://localhost:5173/dashboard"
echo ""
echo "  Stop:   ./start.sh down"
echo "  Reset:  ./start.sh clean && ./start.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"