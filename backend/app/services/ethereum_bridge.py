"""
Citadel — Ethereum Bridge Service

Periodically batches Fabric transaction hashes and anchors them to Sepolia
via the ProofRegistry smart contract. Provides public verifiability for
on-chain Fabric events without migrating the core chaincodes.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from web3 import Web3
from web3.contract import Contract

from app.core.config import settings

logger = logging.getLogger(__name__)

# ABI for ProofRegistry.anchorProof + getProof + proofCount
PROOF_REGISTRY_ABI = [
    {
        "inputs": [
            {"name": "batchHash", "type": "bytes32"},
            {"name": "txCount", "type": "uint256"},
            {"name": "metadata", "type": "string"},
        ],
        "name": "anchorProof",
        "outputs": [{"name": "index", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "index", "type": "uint256"}],
        "name": "getProof",
        "outputs": [
            {
                "components": [
                    {"name": "batchHash", "type": "bytes32"},
                    {"name": "txCount", "type": "uint256"},
                    {"name": "timestamp", "type": "uint256"},
                    {"name": "metadata", "type": "string"},
                ],
                "name": "",
                "type": "tuple",
            }
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "proofCount",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "index", "type": "uint256"},
            {"indexed": True, "name": "batchHash", "type": "bytes32"},
            {"indexed": False, "name": "txCount", "type": "uint256"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "ProofAnchored",
        "type": "event",
    },
]


class TxBuffer:
    """Thread-safe in-memory buffer for Fabric transaction hashes."""

    def __init__(self) -> None:
        self._buffer: list[str] = []
        self._lock = asyncio.Lock()

    async def add_tx(self, tx_hash: str) -> None:
        async with self._lock:
            self._buffer.append(tx_hash)

    async def drain(self) -> list[str]:
        async with self._lock:
            items = self._buffer[:]
            self._buffer.clear()
            return items

    @property
    def size(self) -> int:
        return len(self._buffer)


class EthereumBridge:
    """Submits batched Fabric tx hashes to Sepolia via ProofRegistry."""

    def __init__(
        self,
        rpc_url: str,
        private_key: str,
        contract_address: str,
    ) -> None:
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.account = self.w3.eth.account.from_key(private_key)
        self.contract: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=PROOF_REGISTRY_ABI,
        )
        self._chain_id: Optional[int] = None

    @property
    def chain_id(self) -> int:
        if self._chain_id is None:
            self._chain_id = self.w3.eth.chain_id
        return self._chain_id

    def format_batch(self, tx_hashes: list[str]) -> tuple[bytes, str]:
        """Compute keccak256 of concatenated tx hashes."""
        concatenated = "".join(tx_hashes)
        batch_hash = Web3.keccak(text=concatenated)
        metadata = f"citadel-batch-{int(time.time())}"
        return batch_hash, metadata

    def submit_batch(self, tx_hashes: list[str]) -> str:
        """Submit a batch to the ProofRegistry contract. Returns the tx hash."""
        batch_hash, metadata = self.format_batch(tx_hashes)

        tx_count = len(tx_hashes)
        nonce = self.w3.eth.get_transaction_count(self.account.address)

        # Build the transaction
        tx = self.contract.functions.anchorProof(
            batch_hash, tx_count, metadata
        ).build_transaction({
            "chainId": self.chain_id,
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "nonce": nonce,
        })

        # Sign and send
        signed_tx = self.w3.eth.account.sign_transaction(
            tx, private_key=self.account.key
        )
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        return tx_hash.hex()

    def get_proof_count(self) -> int:
        return self.contract.functions.proofCount().call()

    def get_proof(self, index: int) -> dict:
        proof = self.contract.functions.getProof(index).call()
        return {
            "batchHash": proof[0].hex(),
            "txCount": proof[1],
            "timestamp": proof[2],
            "metadata": proof[3],
        }


# ── Module-level singletons ────────────────────────────────────────────

_tx_buffer = TxBuffer()
_bridge: Optional[EthereumBridge] = None
_anchor_task: Optional[asyncio.Task] = None


def get_tx_buffer() -> TxBuffer:
    return _tx_buffer


def get_ethereum_bridge() -> Optional[EthereumBridge]:
    return _bridge


async def init_ethereum_bridge() -> None:
    """Call from FastAPI lifespan. Starts the background anchor loop."""
    global _bridge, _anchor_task

    rpc_url = getattr(settings, "sepolia_rpc_url", "")
    private_key = getattr(settings, "sepolia_private_key", "")
    contract_address = getattr(settings, "proof_registry_address", "")
    enabled = getattr(settings, "ethereum_bridge_enabled", False)

    if not enabled or not all([rpc_url, private_key, contract_address]):
        logger.info("Ethereum bridge disabled (missing config)")
        return

    try:
        _bridge = EthereumBridge(rpc_url, private_key, contract_address)
        _anchor_task = asyncio.create_task(_anchor_loop())
        logger.info(
            "Ethereum bridge initialised — anchoring to %s every %ds",
            contract_address[:10] + "...",
            getattr(settings, "batch_interval_seconds", 300),
        )
    except Exception as exc:
        logger.warning("Ethereum bridge init failed: %s", exc)


async def shutdown_ethereum_bridge() -> None:
    """Call from FastAPI lifespan shutdown."""
    global _anchor_task
    if _anchor_task is not None:
        _anchor_task.cancel()
        try:
            await _anchor_task
        except asyncio.CancelledError:
            pass
        _anchor_task = None


async def _anchor_loop() -> None:
    """Background task: drain buffer every N seconds and anchor to Sepolia."""
    interval = getattr(settings, "batch_interval_seconds", 300)
    while True:
        try:
            await asyncio.sleep(interval)
            tx_hashes = await _tx_buffer.drain()
            if not tx_hashes or _bridge is None:
                continue

            logger.info("Anchoring %d Fabric tx hashes to Sepolia...", len(tx_hashes))
            start = time.monotonic()
            tx_hash = _bridge.submit_batch(tx_hashes)
            elapsed_ms = int((time.monotonic() - start) * 1000)
            proof_count = _bridge.get_proof_count()

            logger.info(
                "Anchored batch #%d to Sepolia: tx=%s (%d ms, %d hashes)",
                proof_count - 1,
                tx_hash,
                elapsed_ms,
                len(tx_hashes),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Anchor loop error (will retry): %s", exc)
