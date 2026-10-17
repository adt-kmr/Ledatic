"""
Citadel — Unified Advanced-Cybersecurity API
================================================

Router mounted at /api/security. Home of the four advanced modules:

  Phase 1  Active Deception      — /honeypot/report, /threat-stream, /status
  Phase 2  Post-Quantum Shield   — /pqc/*            (see pqc_kem service)
  Phase 3  Anti-Spoofing         — folded into /evaluate (see anti_spoofing)
  Phase 4  zk-SNARK passports     — /zkp/*            (see zkp service)

The crown jewel is POST /api/security/evaluate — a single call that runs every
enabled module and returns one composite verdict. Each module is additive and
degrades gracefully: a module that is disabled or errors contributes a neutral
verdict and never fails the request.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.security import AuthUser, require_role

from app.services.deception import (
    client_ip_from_request,
    get_broadcaster,
    is_blacklisted,
    trigger_trap,
)
from app.services import anti_spoofing, nonce_store
from app.services.pqc_kem import get_pqc_kem
from app.services.zkp_verifier import get_zkp_verifier

# Policy: the maximum risk threshold the zk passport is allowed to assert (the
# public signal order is [maxRiskThreshold, expectedBaselineHash]).
ZK_MAX_ALLOWED_THRESHOLD = 300

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/security", tags=["Advanced Security"])


# ── Phase 1: Active Deception ────────────────────────────────────────────────

class HoneypotReport(BaseModel):
    session_id: str | None = None
    trap_name: str = "DOM_HONEYPOT_FIELD_FILLED"
    value_len: int = 0


@router.post("/honeypot/report")
async def honeypot_report(body: HoneypotReport, request: Request):
    """Frontend calls this when an invisible honeypot form field gets filled.

    Only a bot / naive autofill touches that field, so this is a high-confidence
    intrusion signal: blacklist the IP, broadcast to the FIU panel, and tell the
    caller to hard-block the session.
    """
    ip = client_ip_from_request(request)
    event = await trigger_trap(
        "DOM_HONEYPOT",
        ip,
        f"honeypot field filled ({body.trap_name}, len={body.value_len})",
        session_id=body.session_id,
    )
    return {
        "status": "TRAP_TRIGGERED",
        "decision": "HARD_BLOCK",
        "risk_score": 1000,
        "blacklisted": True,
        "event": event.to_dict(),
    }


@router.post("/deception/reset")
async def deception_reset(
    request: Request,
    all: bool = False,
    caller: AuthUser = Depends(require_role("fiu_admin")),
):
    """Clear the blacklist so a demo can be re-run without self-lockout.
    By default clears only the caller's IP; ?all=true clears everything.
    FIU-admin only — clearing the intrusion blacklist is an enforcement bypass.
    Exempt from the blacklist middleware so a blocked admin can still call it."""
    from app.services import deception as d
    ip = client_ip_from_request(request)
    cleared = []
    r = d.get_redis()
    if all:
        d._local_blacklist.clear()
        if r is not None:
            try:
                async for k in r.scan_iter(match="deception:blacklist:*"):
                    await r.delete(k)
            except Exception:  # noqa: BLE001
                pass
        cleared = ["ALL"]
    else:
        d._local_blacklist.pop(ip, None)
        if r is not None:
            try:
                await r.delete(d.BLACKLIST_KEY.format(ip=ip))
            except Exception:  # noqa: BLE001
                pass
        cleared = [ip]
    return {"status": "CLEARED", "cleared": cleared}


@router.get("/status")
async def deception_status(request: Request):
    """Snapshot for the FIU panel initial load: recent traps + this IP's state."""
    ip = client_ip_from_request(request)
    return {
        "recent_traps": get_broadcaster().recent(),
        "your_ip_blacklisted": await is_blacklisted(ip),
        "decoy_endpoints_armed": True,
    }


# ── Crypto-agility inventory (FIU / CISO quantum-readiness view) ──────────────

# Static, hand-maintained list of the algorithms Citadel endpoints use today.
# quantum_safe: "yes" (NIST PQC or symmetric/hash at >=128-bit post-quantum
# strength), "no" (broken by Shor on a CRQC), "partial" (safe only if key size
# or construction is reviewed). hsm_target is the IBM Crypto Express home for
# the key in the LinuxONE deployment; it is a design target, not running here.
_CRYPTO_INVENTORY = [
    {"id": "verdict-sig", "asset": "Verdict signatures", "endpoint": "/api/security/evaluate",
     "algorithm": "ML-DSA-65 (FIPS 204)", "purpose": "Sign risk verdicts", "quantum_safe": "yes",
     "key_custody": "software", "hsm_target": "Crypto Express (EP11) - ML-DSA key"},
    {"id": "session-kem", "asset": "Key encapsulation", "endpoint": "/api/security/pqc/pubkey",
     "algorithm": "ML-KEM-768 (FIPS 203)", "purpose": "Harvest-now-decrypt-later protection", "quantum_safe": "yes",
     "key_custody": "software", "hsm_target": "Crypto Express (EP11) - ML-KEM key"},
    {"id": "imei-hmac", "asset": "Device-ID hash", "endpoint": "/api/auth/login",
     "algorithm": "HMAC-SHA-256", "purpose": "On-device IMEI hashing, SIM-swap check", "quantum_safe": "yes",
     "key_custody": "software", "hsm_target": "Crypto Express - HMAC salt"},
    {"id": "jwt", "asset": "Session tokens", "endpoint": "/api/auth/*, /api/admin/*",
     "algorithm": "JWT HS256", "purpose": "Customer and analyst sessions", "quantum_safe": "yes",
     "key_custody": "software", "hsm_target": "Crypto Express - signing key"},
    {"id": "password", "asset": "Password storage", "endpoint": "/api/auth/register",
     "algorithm": "bcrypt", "purpose": "Credential hashing", "quantum_safe": "yes",
     "key_custody": "n/a", "hsm_target": None},
    {"id": "zk-passport", "asset": "zk-SNARK passport", "endpoint": "/api/security/zkp/verify",
     "algorithm": "Groth16 over BN254", "purpose": "Cross-bank trust without biometric leakage", "quantum_safe": "no",
     "key_custody": "public params", "hsm_target": None,
     "note": "Pairing-based; plan hash-based STARK or lattice proof."},
    {"id": "eth-anchor", "asset": "Public ledger anchoring", "endpoint": "/api/blockchain/*",
     "algorithm": "ECDSA secp256k1", "purpose": "Optional Ethereum anchoring of verdict hashes", "quantum_safe": "no",
     "key_custody": "software", "hsm_target": None,
     "note": "Replace with private Fabric channel anchoring."},
    {"id": "fabric-identity", "asset": "Fabric peer identities", "endpoint": "blockchain/*",
     "algorithm": "ECDSA P-256", "purpose": "Peer and admin identities, TLS", "quantum_safe": "no",
     "key_custody": "software", "hsm_target": "Crypto Express (PKCS#11) - peer identities",
     "note": "HSM-backed today-safe; migrate to PQC certs when Fabric supports them."},
    {"id": "transport", "asset": "Transport", "endpoint": "all services",
     "algorithm": "TLS 1.2/1.3 (ECDHE)", "purpose": "In-flight encryption", "quantum_safe": "partial",
     "key_custody": "terminator", "hsm_target": None,
     "note": "Enable hybrid X25519+ML-KEM groups at the TLS terminator."},
]


@router.get("/crypto-inventory")
async def crypto_inventory(
    caller: AuthUser = Depends(require_role("fiu_admin", "bank_analyst")),
):
    """Machine-readable algorithm inventory with quantum-safety flags."""
    items = _CRYPTO_INVENTORY
    summary = {
        "total": len(items),
        "quantum_safe": sum(1 for i in items if i["quantum_safe"] == "yes"),
        "partial": sum(1 for i in items if i["quantum_safe"] == "partial"),
        "at_risk": sum(1 for i in items if i["quantum_safe"] == "no"),
    }
    return {"summary": summary, "items": items}


# ── Phase 3: PQC Shield — ML-KEM-768 key encapsulation ────────────────────────

@router.get("/pqc/pubkey")
async def pqc_pubkey():
    """Publish the server's ML-KEM-768 encapsulation key so the client can run
    a post-quantum key exchange before streaming telemetry."""
    kem = get_pqc_kem()
    return {
        "available": kem.available,
        "algorithm": "ML-KEM-768",
        "standard": "NIST FIPS 203",
        "public_key_b64": kem.public_key_b64,
    }


@router.get("/pqc/selftest")
async def pqc_selftest():
    """Full keygen→encaps→decaps round trip — proves the PQC KEM works end-to-end."""
    return get_pqc_kem().selftest()


# ── Phase 4: zk-SNARK biometric passport ──────────────────────────────────────

@router.get("/zkp/params")
async def zkp_params():
    """Public parameters the client needs to build a passport proof."""
    return {
        "available": get_zkp_verifier().available,
        "protocol": "groth16",
        "curve": "bn128",
        "max_risk_threshold": ZK_MAX_ALLOWED_THRESHOLD,
        "wasm_url": "/zkp/behavioral_passport.wasm",
        "zkey_url": "/zkp/behavioral_passport.zkey",
        "public_signal_order": ["maxRiskThreshold", "expectedBaselineHash"],
    }


class ZkProofBody(BaseModel):
    proof: dict
    publicSignals: list


@router.post("/zkp/verify")
async def zkp_verify(body: ZkProofBody):
    """Standalone Groth16 verification of a behavioral-passport proof."""
    ok = get_zkp_verifier().verify(body.proof, body.publicSignals)
    return {"verified": ok, "available": get_zkp_verifier().available}


# ── Phase 2: Anti-Spoofing (nonce issuance + unified evaluate) ────────────────

@router.post("/nonce")
async def issue_nonce():
    """Issue a single-use nonce + ephemeral session key for replay-resistant
    telemetry signing. The client signs (nonce || bundle_digest) with the
    session key and returns it in /evaluate."""
    return await nonce_store.issue()


class HoneypotVector(BaseModel):
    field_interacted: bool = False


class ReplayProof(BaseModel):
    nonce: str | None = None
    bundle_digest: str | None = None
    signature: str | None = None


class MotionSignal(BaseModel):
    values: list[float] = []
    timestamps: list[float] | None = None


class EvaluateRequest(BaseModel):
    session_id: str
    honeypot_vector: HoneypotVector | None = None
    replay_proof: ReplayProof | None = None
    motion_signal: MotionSignal | None = None
    telemetry_bundle: dict | None = None
    # Phase 3/4 fields (PQC ciphertext, zk proof) are added by later modules.
    pqc_ciphertext: str | None = None
    pqc_client_pubkey: str | None = None
    zk_proof: dict | None = None
    # Integration fields: who this verdict belongs to, and the behavioral ML
    # risk to fuse with. Both optional so anonymous pre-auth probes still work.
    customer_hash: str | None = None
    behavioral_risk: int | None = None
    # Set false by demo panels that only want to exercise one module without
    # writing a session row / ledger anchor for every button press.
    persist: bool = True


def _decision_for(score: int) -> str:
    if score >= 700:
        return "HARD_BLOCK"
    if score >= 400:
        return "STEP_UP"
    return "APPROVE"


@router.post("/evaluate")
async def security_evaluate(body: EvaluateRequest, request: Request):
    """Unified advanced-security verdict. Runs every enabled module additively
    and returns one composite decision. A module that is disabled or errors
    contributes a NEUTRAL verdict — it never fails the request.

    NOTE: this is the *security-gate* score (deception/replay/spoof/pqc/zk),
    complementary to the behavioral ML risk from /api/auth/evaluate.
    """
    ip = client_ip_from_request(request)
    verdicts: dict = {}
    security_risk = 0
    notes: list[str] = []

    # ── Deception ─────────────────────────────────────────────────────────
    if await is_blacklisted(ip):
        verdicts["deception_status"] = "BLACKLISTED"
        security_risk = 1000
        notes.append("client IP is blacklisted (prior honeypot hit)")
    elif body.honeypot_vector and body.honeypot_vector.field_interacted:
        await trigger_trap("DOM_HONEYPOT", ip, "honeypot flagged in evaluate", session_id=body.session_id)
        verdicts["deception_status"] = "TRAP_TRIGGERED"
        security_risk = 1000
        notes.append("honeypot field populated — bot")
    else:
        verdicts["deception_status"] = "CLEAN"

    # ── Replay resistance ─────────────────────────────────────────────────
    rp = body.replay_proof
    if rp and rp.nonce and rp.signature and rp.bundle_digest:
        session_key = await nonce_store.consume(rp.nonce)
        if session_key is None:
            verdicts["replay_status"] = "REPLAY_OR_EXPIRED"
            security_risk = max(security_risk, 750)
            notes.append("nonce unknown/expired/spent — possible replay")
        elif anti_spoofing.validate_telemetry_signature(
            session_key, rp.nonce, rp.bundle_digest, rp.signature
        ):
            verdicts["replay_status"] = "FRESH_SIGNED"
        else:
            verdicts["replay_status"] = "BAD_SIGNATURE"
            security_risk = max(security_risk, 750)
            notes.append("telemetry signature mismatch — tampered")
    else:
        verdicts["replay_status"] = "UNSIGNED"  # neutral: no proof supplied

    # ── Micro-tremor FFT (heuristic, never sole decider) ──────────────────
    if body.motion_signal and body.motion_signal.values:
        fft = anti_spoofing.verify_micro_tremor_fft(
            body.motion_signal.values, body.motion_signal.timestamps
        )
        verdicts["micro_tremor_fft"] = fft
        if fft["is_human"] is False:
            security_risk = max(security_risk, 450)  # STEP_UP at most on its own
            notes.append(f"motion lacks human tremor (ratio={fft['tremor_ratio']})")
    else:
        verdicts["micro_tremor_fft"] = {"is_human": None, "reason": "NO_MOTION_SIGNAL"}

    # ── PQC Shield: ML-KEM-768 key encapsulation ──────────────────────────
    pqc_confirm_b64 = None
    if body.pqc_ciphertext:
        kem_res = get_pqc_kem().decapsulate(body.pqc_ciphertext)
        if kem_res.ok:
            verdicts["pqc_shield"] = "VALID_MLKEM768"
            pqc_confirm_b64 = kem_res.confirm_b64  # client verifies mutual agreement
        else:
            verdicts["pqc_shield"] = f"KEM_FAILED:{kem_res.reason}"
            notes.append(f"PQC KEM handshake failed ({kem_res.reason})")
    else:
        verdicts["pqc_shield"] = "SIGNING_ACTIVE"  # Dilithium below still applies
    # ── zk-SNARK Biometric Passport (Groth16) ─────────────────────────────
    if body.zk_proof and isinstance(body.zk_proof, dict):
        proof = body.zk_proof.get("proof")
        public_signals = body.zk_proof.get("publicSignals")
        if proof and public_signals:
            zk_ok = get_zkp_verifier().verify(proof, public_signals)
            if zk_ok is None:
                verdicts["zkp_passport_verified"] = None  # verifier unavailable
            elif zk_ok:
                # Enforce policy: the asserted threshold must be within bound.
                try:
                    asserted_threshold = int(public_signals[0])
                except (ValueError, IndexError, TypeError):
                    asserted_threshold = None
                if asserted_threshold is not None and asserted_threshold <= ZK_MAX_ALLOWED_THRESHOLD:
                    verdicts["zkp_passport_verified"] = True
                else:
                    verdicts["zkp_passport_verified"] = False
                    security_risk = max(security_risk, 400)
                    notes.append(f"zk proof valid but threshold {asserted_threshold} exceeds policy")
            else:
                verdicts["zkp_passport_verified"] = False
                security_risk = max(security_risk, 500)
                notes.append("zk passport proof failed verification")
        else:
            verdicts["zkp_passport_verified"] = None
    else:
        verdicts.setdefault("zkp_passport_verified", None)  # not provided

    decision = _decision_for(security_risk)

    # ── Sign the verdict with the existing Dilithium-3 (NIST FIPS 204) signer ─
    dilithium_signature = None
    pqc_algorithm = None
    try:
        from app.services.pqc_signer import get_pqc_signer
        pqc = get_pqc_signer()
        if pqc and pqc.available:
            sig = pqc.sign_behavioral_hash({
                "session_id": body.session_id,
                "decision": decision,
                "security_risk": security_risk,
                "verdicts": {k: (v if not isinstance(v, dict) else v.get("reason")) for k, v in verdicts.items()},
            })
            dilithium_signature = sig.signature_b64
            pqc_algorithm = sig.algorithm
            # Only reflect signing in pqc_shield when no KEM handshake set it —
            # otherwise the VALID_MLKEM768 / KEM_FAILED verdict would be clobbered.
            if verdicts.get("pqc_shield") == "SIGNING_ACTIVE":
                verdicts["pqc_shield"] = f"SIGNED_{sig.algorithm.replace('-', '').upper()}"
    except Exception as exc:  # noqa: BLE001
        logger.debug("Dilithium verdict signing skipped: %s", exc)

    # ── Integration: fuse with ML risk, persist, and anchor on-chain ───────
    # These close the gap between the security gate and the rest of the engine.
    # All three are best-effort: a failure here degrades the response payload
    # but never the verdict itself.
    from app.services import security_integration as si

    fused_risk = si.fuse_risk(body.behavioral_risk or 0, security_risk)
    fused_decision = _decision_for(fused_risk)

    persisted_session_id = None
    anchor = {"on_chain": False, "reason": "not_attempted"}
    if body.persist:
        persisted_session_id = await si.persist_security_verdict(
            session_id=body.session_id,
            customer_hash=body.customer_hash,
            decision=decision,
            security_risk=security_risk,
            verdicts=verdicts,
            notes=notes,
            dilithium_signature=dilithium_signature,
            pqc_algorithm=pqc_algorithm,
            client_ip=ip,
        )
        anchor = await si.anchor_security_verdict(
            customer_hash=body.customer_hash,
            session_id=body.session_id,
            decision=decision,
            security_risk=security_risk,
            verdicts=verdicts,
            dilithium_signature=dilithium_signature,
            pqc_algorithm=pqc_algorithm,
        )

    return {
        "status": "SUCCESS",
        "session_id": body.session_id,
        "decision": decision,
        "security_risk_score": security_risk,
        "cyber_verdicts": verdicts,
        "notes": notes,
        "pqc_algorithm": pqc_algorithm,
        "pqc_kem_confirm": pqc_confirm_b64,
        "dilithium_signature": dilithium_signature,
        # ── integration surface ──
        "behavioral_risk": body.behavioral_risk,
        "fused_risk_score": fused_risk,
        "fused_decision": fused_decision,
        "persisted_session_id": persisted_session_id,
        "blockchain_anchor": anchor,
    }


@router.get("/threat-stream")
async def threat_stream():
    """Server-Sent Events stream of live deception traps for the FIU Fraud-Ops
    Command Center. Open (no auth) so the public demo panel can subscribe; it
    only emits coarse trap events (IP + reason), never PII.
    """
    broadcaster = get_broadcaster()

    async def generate():
        q = broadcaster.subscribe()
        try:
            # Replay very recent events so a panel that connects a beat late
            # still shows the trap that was just sprung on stage.
            for ev in broadcaster.recent()[-10:]:
                yield f"data: {json.dumps(ev)}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat keeps proxies (Render/Vercel) from closing idle SSE.
                    yield ": keep-alive\n\n"
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
