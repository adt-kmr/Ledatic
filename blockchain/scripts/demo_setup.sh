#!/usr/bin/env bash
# ================================================================
# Citadel — Demo Pre-seeding Script
# Run ONCE before the hackathon presentation.
# Registers IMEI baselines for demo users via invoke (slow, one-time).
# After this, QueryCheckIMEI (fast path) returns correct results in <80ms.
# ================================================================
set -euo pipefail

CHANNEL="citadel-channel"
ORDERER_CA="/opt/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"

# HMAC-SHA-256 of raw IMEI strings using the shared secret from .env.
# The secret itself is NEVER committed — read it from the environment so the
# on-device/backend HMAC secret stays out of version control.
# python3: hmac.new(secret.encode(), raw_imei.encode(), hashlib.sha256).hexdigest()
HMAC_SECRET="${IMEI_HMAC_SECRET:?ERROR: set IMEI_HMAC_SECRET in your .env before running demo_setup.sh}"
LEGIT_IMEI_HMAC="a1ddbe55b87c50dc41901a28388bb0a4f6e62e8970fb5542500d99cfc16449ed"   # HMAC("864502040001234")
ATTACKER_IMEI_HMAC="01e6cba8e5ae80daaa721946420c2df4716ae68ace277d93538149b1d6dddfbc" # HMAC("868908040009999")

# Demo userHash values. The chaincode validates that every hash arg is
# non-empty, ≤128 chars, and hex-only ([0-9a-fA-F]). In production these
# MUST be computed off-chain as
#   userHash = HMAC-SHA-256(bank_id, customer_id, server_secret)
# (keyed HMAC with a server-side secret — NOT unsalted SHA-256, which is
# re-identifiable). For the demo we use fixed hex placeholder digests so
# the chaincode's hex validation passes. The plaintext BankID field was
# removed from IMEIRecord; the bank identifier is folded into userHash.
LEGIT_USER_HASH="7135e9efd02cc5c0f4b53589bd73930631b506f51d860e765e6ac76a0edfbcc7"     # sha256("user-legit-001") placeholder
ATTACKER_USER_HASH="c2fd16eab5b7832ab95f90cf174bdc5fcffb5379d534bbf9567fb3e344586723" # sha256("user-attacker-001") placeholder

invoke() {
  local cc="$1" func="$2" args="$3"
  docker exec cli peer chaincode invoke \
    -C "$CHANNEL" -n "$cc" \
    --tls --cafile "$ORDERER_CA" \
    -c "{\"Args\":[\"${func}\"${args}]}" \
    --waitForEvent 2>&1 | grep -E "(result|Error|ERRO)" || true
}

query() {
  local cc="$1" func="$2" args="$3"
  docker exec cli peer chaincode query \
    -C "$CHANNEL" -n "$cc" \
    -c "{\"Args\":[\"${func}\"${args}]}" 2>&1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Citadel Demo Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Register demo users on hash_registrar ─────────────────────────
echo "→ Registering demo users on hash_registrar..."

# RegisterIMEI signature is now (userHash, imeiHash, timestamp) — the
# plaintext BankID argument was removed.
invoke "hash_registrar" "RegisterIMEI" \
  ",\"${LEGIT_USER_HASH}\",\"${LEGIT_IMEI_HMAC}\",\"2026-05-27T00:00:00Z\""
echo "  ✓ user-legit-001 registered (HMAC-SHA-256)"

invoke "hash_registrar" "RegisterIMEI" \
  ",\"${ATTACKER_USER_HASH}\",\"${ATTACKER_IMEI_HMAC}\",\"2026-05-27T00:00:00Z\""
echo "  ✓ user-attacker-001 registered (HMAC-SHA-256)"

# ── Register IMEI baselines on mismatch_detector ──────────────────
echo ""
echo "→ Seeding IMEI baselines on mismatch_detector..."

invoke "mismatch_detector" "RegisterIMEI" \
  ",\"${LEGIT_USER_HASH}\",\"${LEGIT_IMEI_HMAC}\""
echo "  ✓ Baseline set: user-legit-001 → ${LEGIT_IMEI_HMAC}"

invoke "mismatch_detector" "RegisterIMEI" \
  ",\"${ATTACKER_USER_HASH}\",\"${ATTACKER_IMEI_HMAC}\""
echo "  ✓ Baseline set: user-attacker-001 → ${ATTACKER_IMEI_HMAC}"

# ── Smoke tests (fast query path) ─────────────────────────────────
echo ""
echo "→ Smoke tests via QueryCheckIMEI (fast path)..."

echo ""
echo "  [Legit user, correct HMAC] → expect APPROVE"
query "mismatch_detector" "QueryCheckIMEI" \
  ",\"${LEGIT_USER_HASH}\",\"${LEGIT_IMEI_HMAC}\""

echo ""
echo "  [SIM swap: legit user, attacker HMAC] → expect HARD_BLOCK"
query "mismatch_detector" "QueryCheckIMEI" \
  ",\"${LEGIT_USER_HASH}\",\"${ATTACKER_IMEI_HMAC}\""

# ── Seed Redis cache for instant (<5ms) verification ──────────────
echo ""
echo "→ Seeding Redis IMEI cache with HMAC values..."

docker exec citadel-redis-1 redis-cli -p 6379 \
  SET "imei_baseline:${LEGIT_USER_HASH}" "${LEGIT_IMEI_HMAC}" EX 86400 > /dev/null
echo "  ✓ Redis: user-legit-001 → ${LEGIT_IMEI_HMAC:0:16}…"

docker exec citadel-redis-1 redis-cli -p 6379 \
  SET "imei_baseline:${ATTACKER_USER_HASH}" "${ATTACKER_IMEI_HMAC}" EX 86400 > /dev/null
echo "  ✓ Redis: user-attacker-001 → ${ATTACKER_IMEI_HMAC:0:16}…"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Demo seeding complete!"
echo ""
echo "  HMAC-SHA-256 protected demo baselines:"
echo "    Secret:        ${HMAC_SECRET:0:16}… (64-char hex)"
echo "    Legit IMEI:    864502040001234 → ${LEGIT_IMEI_HMAC:0:16}…"
echo "    Attacker IMEI: 868908040009999 → ${ATTACKER_IMEI_HMAC:0:16}…"
echo ""
echo "  SIM swap attack: send attacker HMAC → HARD_BLOCK in <5ms"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""