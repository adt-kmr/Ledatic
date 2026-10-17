#!/usr/bin/env bash
# ================================================================
# Citadel — Start Hyperledger Fabric Network (1-org)
# ================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(dirname "$SCRIPT_DIR")"

ORDERER_CA="/opt/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
CHANNEL_TX="/opt/channel-artifacts/citadel-channel.tx"

echo "→ Starting Hyperledger Fabric network..."
docker compose -f "$BLOCKCHAIN_DIR/docker-compose.fabric.yml" up -d

echo "→ Waiting for orderer and peer to start (10s)..."
sleep 10

echo "→ Creating channel citadel-channel..."
docker exec cli peer channel create \
  -o orderer.example.com:7050 \
  -c citadel-channel \
  -f "${CHANNEL_TX}" \
  --tls --cafile "${ORDERER_CA}" \
  --outputBlock /opt/channel-artifacts/citadel-channel.block

echo "→ Joining peer0.org1 to channel..."
docker exec cli peer channel join \
  -b /opt/channel-artifacts/citadel-channel.block

echo "→ Updating anchor peers..."
docker exec cli peer channel update \
  -o orderer.example.com:7050 \
  -c citadel-channel \
  -f /opt/channel-artifacts/Org1MSPanchors.tx \
  --tls --cafile "${ORDERER_CA}" 2>/dev/null || true  # optional — skip if tx not generated

echo "→ Deploying chaincodes..."
bash "$SCRIPT_DIR/deploy_chaincode.sh"

echo ""
echo "✓ Fabric network is up. Chaincodes deployed to citadel-channel."
echo ""
echo "Quick check:"
echo "  docker exec cli peer channel list"
echo "  docker exec cli peer lifecycle chaincode querycommitted -C citadel-channel"
