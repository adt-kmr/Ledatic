#!/usr/bin/env bash
# ================================================================
# Citadel — Chaincode Lifecycle Deployment (Fabric 2.x)
# Deploys: hash_registrar, mismatch_detector, mule_detector
# All 3 chaincodes to channel: citadel-channel
# ================================================================
set -euo pipefail

CHANNEL_NAME="citadel-channel"
ORDERER_CA="/opt/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
PEER_TLS_ROOTCERT="/opt/crypto/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
# Sequence/version are overridable so a single chaincode can be UPGRADED in
# place without redeploying the whole set. Fabric requires the sequence to
# increment by exactly 1 per definition change.
#   Upgrade just one:  SEQUENCE=2 CC_VERSION=1.1 ./deploy_chaincode.sh hash_registrar
#   Fresh deploy all:  ./deploy_chaincode.sh
SEQUENCE="${SEQUENCE:-1}"
CC_VERSION="${CC_VERSION:-1.0}"

deploy_chaincode() {
  local CC_NAME="$1"
  local CC_SRC="/opt/gopath/src/github.com/chaincode/${CC_NAME}"
  local CC_LABEL="${CC_NAME}_${CC_VERSION}"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "→ Deploying: ${CC_NAME}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 1. Package
  echo "  [1/4] Packaging..."
  docker exec cli peer lifecycle chaincode package \
    "/tmp/${CC_NAME}.tar.gz" \
    --path "${CC_SRC}" \
    --lang golang \
    --label "${CC_LABEL}"

  # 2. Install
  echo "  [2/4] Installing on peer0.org1..."
  docker exec cli peer lifecycle chaincode install \
    "/tmp/${CC_NAME}.tar.gz"

  # 3. Get package ID and approve
  echo "  [3/4] Approving for Org1MSP..."
  PACKAGE_ID=$(docker exec cli peer lifecycle chaincode queryinstalled \
    --output json 2>/dev/null \
    | jq -r --arg label "${CC_LABEL}" \
        '.installed_chaincodes[] | select(.label==$label) | .package_id' \
    2>/dev/null)

  if [ -z "$PACKAGE_ID" ]; then
    echo "  ✗ Could not find package ID for ${CC_LABEL}" >&2
    exit 1
  fi
  echo "    Package ID: ${PACKAGE_ID}"

  docker exec cli peer lifecycle chaincode approveformyorg \
    --channelID "${CHANNEL_NAME}" \
    --name "${CC_NAME}" \
    --version "${CC_VERSION}" \
    --package-id "${PACKAGE_ID}" \
    --sequence "${SEQUENCE}" \
    --tls \
    --cafile "${ORDERER_CA}"

  # 4. Commit
  echo "  [4/4] Committing to channel..."
  docker exec cli peer lifecycle chaincode commit \
    --channelID "${CHANNEL_NAME}" \
    --name "${CC_NAME}" \
    --version "${CC_VERSION}" \
    --sequence "${SEQUENCE}" \
    --tls \
    --cafile "${ORDERER_CA}" \
    --peerAddresses peer0.org1.example.com:7051 \
    --tlsRootCertFiles "${PEER_TLS_ROOTCERT}"

  echo "  ✓ ${CC_NAME} deployed."
}

# Deploy only the chaincodes named as arguments, or all three by default.
if [ "$#" -gt 0 ]; then
  for cc in "$@"; do deploy_chaincode "$cc"; done
  echo ""
  echo "✓ Deployed to '${CHANNEL_NAME}': $* (sequence ${SEQUENCE}, version ${CC_VERSION})."
else
  deploy_chaincode "hash_registrar"
  deploy_chaincode "mismatch_detector"
  deploy_chaincode "mule_detector"
  echo ""
  echo "✓ All 3 chaincodes deployed to '${CHANNEL_NAME}'."
fi
echo ""
echo "Smoke test — RegisterIMEI:"
echo "  docker exec cli peer chaincode invoke \\"
echo "    -C ${CHANNEL_NAME} -n hash_registrar \\"
echo "    --tls --cafile \${ORDERER_CA} \\"
echo "    -c '{\"Args\":[\"RegisterIMEI\",\"user-hash-001\",\"imei-hash-001\",\"Harsh\",\"2026-05-27T00:00:00Z\"]}'"
