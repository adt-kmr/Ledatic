#!/usr/bin/env bash
# Comprehensive endpoint smoke test for Citadel stack
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8000}"
ML="${ML_URL:-http://localhost:8001}"
CAMARA="${CAMARA_URL:-http://localhost:8002}"

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1" method="$2" url="$3" expected="$4" body="${5:-}" headers="${6:-}"
  local code
  if [ -n "$body" ]; then
    if [ -n "$headers" ]; then
      code=$(curl -s -o /tmp/smoke_body.json -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -H "$headers" -d "$body")
    else
      code=$(curl -s -o /tmp/smoke_body.json -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$body")
    fi
  else
    if [ -n "$headers" ]; then
      code=$(curl -s -o /tmp/smoke_body.json -w "%{http_code}" -X "$method" "$url" -H "$headers")
    else
      code=$(curl -s -o /tmp/smoke_body.json -w "%{http_code}" -X "$method" "$url")
    fi
  fi
  if [ "$code" = "$expected" ]; then
    echo "✓ $name ($code)"
    PASS=$((PASS+1))
  else
    echo "✗ $name — expected $expected, got $code"
    head -c 200 /tmp/smoke_body.json 2>/dev/null; echo
    FAIL=$((FAIL+1))
  fi
}

echo "=== Citadel Endpoint Smoke Test ==="
echo "Backend: $BASE | ML: $ML | CAMARA: $CAMARA"
echo

# Health checks
check "Backend /health" GET "$BASE/health" 200
check "ML /health" GET "$ML/health" 200
check "CAMARA /sim-swap/check" POST "$CAMARA/sim-swap/check" 200 '{"msisdn":"919876543210"}'

# Public auth
check "GET /api/auth/demo/accounts" GET "$BASE/api/auth/demo/accounts" 200
LOGIN_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"customer_id":"demo","password":"Demo@2026"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
USER_HASH=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_hash',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "✗ Login failed — cannot test authenticated endpoints"
  echo "$LOGIN_RESP"
  exit 1
fi
echo "✓ POST /api/auth/login (200)"
PASS=$((PASS+1))
AUTH="Authorization: Bearer $TOKEN"
SESSION_ID=$(python3 -c "import uuid; print(uuid.uuid4())")

# Authenticated endpoints
check "GET /api/passport/demo" GET "$BASE/api/passport/demo" 200 "" "$AUTH"
check "GET /api/brq/questions" GET "$BASE/api/brq/questions" 200 "" "$AUTH"
check "GET /api/gravity/profile" GET "$BASE/api/gravity/profile" 200 "" "$AUTH"
check "GET /api/gravity/profile/demo" GET "$BASE/api/gravity/profile/demo" 200 "" "$AUTH"
check "GET /api/blockchain/ledger" GET "$BASE/api/blockchain/ledger" 200 "" "$AUTH"
check "GET /api/blockchain/proofs" GET "$BASE/api/blockchain/proofs" 200 "" "$AUTH"
check "GET /api/blockchain/pqc-status" GET "$BASE/api/blockchain/pqc-status" 200 "" "$AUTH"
check "GET /api/fraud/reports" GET "$BASE/api/fraud/reports" 200 "" "$AUTH"
check "GET /api/payments/qr-scans" GET "$BASE/api/payments/qr-scans" 200 "" "$AUTH"
check "GET /api/duress/setup" GET "$BASE/api/duress/setup" 200 "" "$AUTH"
check "GET /api/duress/active" GET "$BASE/api/duress/active" 200 "" "$AUTH"
check "GET /api/duress/my-incidents" GET "$BASE/api/duress/my-incidents" 200 "" "$AUTH"
check "GET /api/auth/live-sessions (customer forbidden)" GET "$BASE/api/auth/live-sessions" 403 "" "$AUTH"

# Signal ingest + preview
SIGNAL_BODY=$(cat <<EOF
{"session_id":"$SESSION_ID","channel":"internet_banking","signal_bundle":{"keystrokeEvents":[],"mouseEvents":[],"touchEvents":[],"navigationEvents":[],"environment":{"screenShareActive":false,"clipboardPasteDetected":false,"hesitationWindows":[],"vpnActive":false,"imeiHash":"abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890"}}}
EOF
)
check "POST /api/signals/ingest" POST "$BASE/api/signals/ingest" 200 "$SIGNAL_BODY" "$AUTH"
check "GET /api/auth/preview/{session}" GET "$BASE/api/auth/preview/$SESSION_ID" 200 "" "$AUTH"

# Evaluate
EVAL_BODY=$(cat <<EOF
{"session_id":"$SESSION_ID","user_id":"demo","user_hash":"$USER_HASH","imei_hash":"abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890","channel":"internet_banking","signal_bundle":{"keystrokeEvents":[{"eventType":"keydown","timestamp":1,"key":"h","dwellTime":80,"flightTime":50}],"mouseEvents":[],"touchEvents":[],"navigationEvents":[],"environment":{"screenShareActive":false,"clipboardPasteDetected":false,"hesitationWindows":[],"vpnActive":false,"imeiHash":"abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890"}}}
EOF
)
check "POST /api/auth/evaluate" POST "$BASE/api/auth/evaluate" 200 "$EVAL_BODY" "$AUTH"

# Gravity evaluate
check "POST /api/gravity/evaluate" POST "$BASE/api/gravity/evaluate" 200 \
  '{"amount":5000,"category":"food","beneficiary":"Swiggy"}' "$AUTH"

# Admin login
ADMIN_RESP=$(curl -s -X POST "$BASE/api/admin/login" -H "Content-Type: application/json" \
  -d '{"admin_id":"ADMIN","password":"ADMIN"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
if [ -n "$ADMIN_TOKEN" ]; then
  ADMIN_AUTH="Authorization: Bearer $ADMIN_TOKEN"
  check "GET /api/admin/overview" GET "$BASE/api/admin/overview" 200 "" "$ADMIN_AUTH"
  check "GET /api/admin/sessions" GET "$BASE/api/admin/sessions" 200 "" "$ADMIN_AUTH"
  check "GET /api/admin/config/thresholds" GET "$BASE/api/admin/config/thresholds" 200 "" "$ADMIN_AUTH"
  check "GET /api/auth/live-sessions" GET "$BASE/api/auth/live-sessions" 200 "" "$ADMIN_AUTH"
  check "GET /api/btic/hero/stats" GET "$BASE/api/btic/hero/stats" 200 "" "$ADMIN_AUTH"
  check "GET /api/btic/campaigns" GET "$BASE/api/btic/campaigns" 200 "" "$ADMIN_AUTH"
  check "GET /api/btic/analytics/trends" GET "$BASE/api/btic/analytics/trends" 200 "" "$ADMIN_AUTH"
else
  echo "⊘ Admin endpoints skipped (login failed)"
  SKIP=$((SKIP+3))
fi

# BTIC with user token
check "GET /api/btic/threats/aggregate" GET "$BASE/api/btic/threats/aggregate" 200 "" "$AUTH"

# Unauthorized should fail
check "POST /api/auth/evaluate (no auth)" POST "$BASE/api/auth/evaluate" 401 "$EVAL_BODY"

echo
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
[ "$FAIL" -eq 0 ]
