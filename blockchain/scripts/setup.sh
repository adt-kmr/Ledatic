#!/usr/bin/env bash
# ================================================================
# Citadel — Hyperledger Fabric Network Setup
# Run once before starting the network.
# ================================================================
set -euo pipefail

FABRIC_VERSION="2.5.9"
CA_VERSION="1.5.12"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(dirname "$SCRIPT_DIR")"
NETWORK_DIR="$BLOCKCHAIN_DIR/network"

echo "→ Setting up Hyperledger Fabric network..."

# 1. Download Fabric binaries if not present
if [ ! -f "$BLOCKCHAIN_DIR/bin/peer" ]; then
  echo "→ Downloading Fabric binaries v${FABRIC_VERSION}..."
  mkdir -p "$BLOCKCHAIN_DIR/bin"
  cd "$BLOCKCHAIN_DIR"
  curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh \
    | bash -s -- --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" binary
  cd - > /dev/null
fi

export PATH="$BLOCKCHAIN_DIR/bin:$PATH"
export FABRIC_CFG_PATH="$NETWORK_DIR"

# 2. Generate crypto material
echo "→ Generating crypto material..."
cryptogen generate \
  --config="$NETWORK_DIR/crypto-config.yaml" \
  --output="$BLOCKCHAIN_DIR/crypto-config"

# 3. Generate genesis block (1-org profile)
echo "→ Generating genesis block..."
mkdir -p "$BLOCKCHAIN_DIR/channel-artifacts"
configtxgen \
  -profile OneOrgOrdererGenesis \
  -channelID citadel-sys-channel \
  -outputBlock "$BLOCKCHAIN_DIR/channel-artifacts/genesis.block"

# 4. Generate channel transaction (1-org profile)
configtxgen \
  -profile OneOrgChannel \
  -outputCreateChannelTx "$BLOCKCHAIN_DIR/channel-artifacts/citadel-channel.tx" \
  -channelID citadel-channel

echo "✓ Fabric setup complete. Run 'make fabric-up' to start the network."
