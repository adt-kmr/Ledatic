#!/usr/bin/env bash
# ================================================================
# Citadel — Stop Hyperledger Fabric Network
# ================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(dirname "$SCRIPT_DIR")"

echo "→ Stopping Hyperledger Fabric network..."
docker compose -f "$BLOCKCHAIN_DIR/docker-compose.fabric.yml" down -v
echo "✓ Fabric network stopped."
