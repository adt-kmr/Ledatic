"""
Citadel Fabric Client
Invokes Hyperledger Fabric 2.5 chaincodes via `docker exec cli peer chaincode` subprocess.
No Python Fabric SDK required — uses the cli container deployed with the network.

Why subprocess: No stable Python Fabric SDK is available on PyPI for Fabric 2.5.
The cli container already has peer binary + TLS certs mounted — this is the
cleanest approach for a hackathon demo and produces identical results.

Latency for local Docker query: ~30-60ms (well under the 80ms SIM swap target).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from typing import Optional

from app.services.ethereum_bridge import get_tx_buffer

logger = logging.getLogger(__name__)

CHANNEL = "citadel-channel"
ORDERER_CA = (
    "/opt/crypto/ordererOrganizations/example.com/orderers/"
    "orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
)


async def _query(chaincode: str, func: str, args: list[str]) -> dict:
    """
    Read-only chaincode query via `docker exec cli peer chaincode query`.
    Returns the parsed JSON payload.
    Raises RuntimeError on timeout or non-zero exit.
    """
    cli_args = json.dumps({"Args": [func] + args})
    cmd = [
        "docker", "exec", "cli",
        "peer", "chaincode", "query",
        "-C", CHANNEL,
        "-n", chaincode,
        "-c", cli_args,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except asyncio.TimeoutError:
        raise RuntimeError(f"Chaincode query timed out: {chaincode}.{func}")

    if proc.returncode != 0:
        raise RuntimeError(
            f"Chaincode query failed [{chaincode}.{func}]: {stderr.decode().strip()}"
        )

    raw = stdout.decode().strip()
    return json.loads(raw)


async def _invoke(chaincode: str, func: str, args: list[str]) -> dict:
    """
    State-writing chaincode invoke via `docker exec cli peer chaincode invoke`.
    Parses the payload from the peer's log output.
    """
    cli_args = json.dumps({"Args": [func] + args})
    cmd = [
        "docker", "exec", "cli",
        "peer", "chaincode", "invoke",
        "-C", CHANNEL,
        "-n", chaincode,
        "--tls", "--cafile", ORDERER_CA,
        "-c", cli_args,
        "--waitForEvent",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
    except asyncio.TimeoutError:
        raise RuntimeError(f"Chaincode invoke timed out: {chaincode}.{func}")

    output = (stdout.decode() + stderr.decode())
    if proc.returncode != 0:
        raise RuntimeError(f"Chaincode invoke failed [{chaincode}.{func}]: {output.strip()}")

    # Extract payload from: "result: status:200 payload:\"...\""
    # Use escape-aware regex: matches any char except unescaped "
    match = re.search(r'payload:"((?:[^"\\]|\\.)*)"', output)
    if match:
        try:
            payload_str = match.group(1).replace('\\"', '"')
            return json.loads(payload_str)
        except json.JSONDecodeError:
            pass

    # Fallback: try stdout as raw JSON
    try:
        result = json.loads(stdout.decode().strip())
    except Exception:
        result = {"status": "ok", "raw": output.strip()}

    # Buffer a hash of this transaction for Ethereum anchoring
    tx_id = hashlib.sha256(output.encode()).hexdigest()
    asyncio.get_event_loop().create_task(get_tx_buffer().add_tx(tx_id))

    return result


class FabricClient:
    """
    Async Fabric chaincode client.
    All methods are coroutines — compatible with FastAPI's async handlers.
    Non-fatal: FastAPI starts normally even if cli container is not running.
    """

    # ── HashRegistrar ─────────────────────────────────────────────────

    async def register_imei(
        self, user_hash: str, imei_hash: str, timestamp: str
    ) -> dict:
        """Write IMEI hash to blockchain on first enrollment.

        hash_registrar.RegisterIMEI signature is (userHash, imeiHash, timestamp) —
        the plaintext BankID argument was removed; the bank identifier is folded
        into the (server-computed, salted) userHash and is never stored on-chain
        in cleartext.
        """
        start = time.monotonic()
        result = await _invoke(
            "hash_registrar", "RegisterIMEI",
            [user_hash, imei_hash, timestamp],
        )
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
        return result

    async def get_record(self, user_hash: str) -> dict:
        """Read stored IMEI record (read-only query)."""
        return await _query("hash_registrar", "GetIMEIRecord", [user_hash])

    # ── MismatchDetector ──────────────────────────────────────────────

    async def check_imei(self, user_hash: str, current_imei_hash: str) -> dict:
        """
        Enroll path: self-registers IMEI baseline on first call, then compares.
        Uses invoke (state-writing) — ~2s due to block commit. Use for enrollment only.
        """
        start = time.monotonic()
        result = await _invoke(
            "mismatch_detector", "CheckIMEI",
            [user_hash, current_imei_hash],
        )
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
        return result

    async def check_imei_fast(self, user_hash: str, current_imei_hash: str) -> dict:
        """
        Fast verification path: read-only query, no block commit wait.
        Returns APPROVE or HARD_BLOCK in ~30-50ms.
        Requires IMEI baseline already enrolled via check_imei() or demo_setup.
        """
        start = time.monotonic()
        result = await _query(
            "mismatch_detector", "QueryCheckIMEI",
            [user_hash, current_imei_hash],
        )
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
        return result

    # ── MuleDetector ──────────────────────────────────────────────────

    async def record_transfer(
        self,
        recipient_hash: str,
        sender_hash: str,
        sender_is_flagged: bool,
        timestamp: str,
    ) -> dict:
        """Record inbound transfer and check mule pattern."""
        return await _invoke(
            "mule_detector", "RecordTransfer",
            [recipient_hash, sender_hash, str(sender_is_flagged).lower(), timestamp],
        )

    async def is_account_flagged(self, user_hash: str) -> bool:
        """Returns True if account flagged as money mule."""
        result = await _query("mule_detector", "IsAccountFlagged", [user_hash])
        return str(result).lower() == "true"

    # ── PQC Behavioral Passport ───────────────────────────────────────────

    async def register_behavioral_passport(
        self,
        user_hash: str,
        behavioral_hash: str,
        dilithium_signature: str,
        dilithium_pubkey: str,
        algorithm: str,
        timestamp: str,
    ) -> dict:
        """
        Write a Dilithium-3-signed behavioral passport to the Fabric ledger.

        Stores: { userHash, behavioralHash, dilithiumSignature, dilithiumPubkey,
                  algorithm, timestamp } under the hash_registrar chaincode.
        The chaincode function 'RegisterBehavioralPassport' must be defined in
        the chaincode — if it returns an unknown function error, the call is
        treated as best-effort and logged. The passport is still stored in Postgres.
        """
        start = time.monotonic()
        try:
            result = await _invoke(
                "hash_registrar", "RegisterBehavioralPassport",
                [user_hash, behavioral_hash, dilithium_signature, dilithium_pubkey,
                 algorithm, timestamp],
            )
            result["latency_ms"] = int((time.monotonic() - start) * 1000)
            logger.info(
                "🔮 PQC passport registered on-chain | user=%s | hash=%s… | latency=%dms",
                user_hash[:12], behavioral_hash[:16], result["latency_ms"]
            )
            return result
        except Exception as exc:
            # Best-effort — Fabric may not have the chaincode function yet
            logger.debug(
                "PQC on-chain passport registration skipped (non-fatal): %s", exc
            )
            return {"status": "skipped", "reason": str(exc), "on_chain": False}

    async def register_security_verdict(
        self,
        user_hash: str,
        verdict_hash: str,
        decision: str,
        risk_score: int,
        trigger: str,
        signature: str,
        algorithm: str,
        timestamp: str,
    ) -> dict:
        """
        Anchor an advanced-security HARD_BLOCK on the Fabric ledger.

        Backed by hash_registrar's `RegisterSecurityVerdict` (chaincode v1.1,
        sequence 2). Only the verdict DIGEST is written — never raw telemetry
        or PII — plus the Dilithium-3 signature so the block stays
        independently verifiable as post-quantum authentic.

        Idempotent on the chaincode side: re-anchoring the same digest is a
        no-op rather than an error, so a retry after a network blip is safe.
        """
        start = time.monotonic()
        try:
            result = await _invoke(
                "hash_registrar", "RegisterSecurityVerdict",
                [user_hash, verdict_hash, decision, str(risk_score), trigger,
                 signature or "", algorithm or "Dilithium-3", timestamp],
            )
            latency = int((time.monotonic() - start) * 1000)
            result["latency_ms"] = latency
            result["on_chain"] = True
            logger.info(
                "🔗 Security verdict anchored on-chain | user=%s | verdict=%s… | %s | %dms",
                user_hash[:12], verdict_hash[:16], decision, latency,
            )
            return result
        except Exception as exc:
            # Fabric down is a documented, expected degradation path — report
            # it honestly rather than pretending the write succeeded.
            logger.debug("Security verdict anchoring skipped (non-fatal): %s", exc)
            return {"status": "skipped", "reason": str(exc), "on_chain": False}

    async def get_security_verdict(self, verdict_hash: str) -> dict:
        """Read back a previously anchored security verdict (proof of write)."""
        try:
            return await _query(
                "hash_registrar", "GetSecurityVerdict", [verdict_hash]
            )
        except Exception as exc:
            return {"status": "skipped", "reason": str(exc), "on_chain": False}

    async def get_behavioral_passport(self, user_hash: str) -> dict:
        """
        Read the stored PQC behavioral passport from the Fabric ledger.
        Returns the stored record or an empty dict if not found / chain down.
        """
        try:
            return await _query(
                "hash_registrar", "GetBehavioralPassport", [user_hash]
            )
        except Exception as exc:
            logger.debug("PQC passport query skipped (non-fatal): %s", exc)
            return {}


# ── Module-level singleton ────────────────────────────────────────────
_client: Optional[FabricClient] = None


def get_fabric_client() -> Optional[FabricClient]:
    """FastAPI dependency — returns None if Fabric not running (graceful degradation)."""
    return _client


def init_fabric_client() -> None:
    """
    Call from FastAPI lifespan.
    Lightweight — just creates the client object (no connection until first call).
    """
    global _client
    _client = FabricClient()
    logger.info("Fabric client initialised (cli subprocess mode)")
