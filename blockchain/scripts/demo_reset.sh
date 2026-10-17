#!/usr/bin/env bash
# ================================================================
# Citadel — Demo Reset Script
# Run before live presentation to get clean predictable results.
# Clears progressive-penalty counters but keeps IMEI baselines intact.
# ================================================================
set -euo pipefail

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Citadel Demo Reset"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Surgical clear: only login_failures (progressive penalty)
echo "→ Clearing progressive-penalty counters from Redis..."
KEYS=$(docker exec citadel-redis-1 redis-cli --scan --pattern "login_failures:*" 2>/dev/null || true)
if [ -n "$KEYS" ]; then
  echo "$KEYS" | while read -r k; do
    [ -n "$k" ] && docker exec citadel-redis-1 redis-cli DEL "$k" > /dev/null
  done
  echo "  ✓ Cleared $(echo "$KEYS" | wc -l) progressive-penalty keys"
else
  echo "  ✓ No penalty counters to clear"
fi

# Verify baselines are still seeded
echo ""
echo "→ Verifying IMEI baselines (should remain seeded)..."
LEGIT=$(docker exec citadel-redis-1 redis-cli GET "imei_baseline:user-legit-001" || echo "")
if [ -n "$LEGIT" ]; then
  echo "  ✓ user-legit-001 baseline present: ${LEGIT:0:16}…"
else
  echo "  ⚠ Baseline missing — run blockchain/scripts/demo_setup.sh first"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Reset complete. Demo ready."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
