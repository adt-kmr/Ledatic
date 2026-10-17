"""
Citadel — Advanced-Security integration layer
=================================================

The four advanced modules (deception, replay/anti-spoof, PQC, zk passport)
originally computed a verdict and returned it — nothing was persisted, the ML
engine never saw it, and no verdict reached the ledger. This module closes
those three gaps so the security gate is part of the system rather than an
isolated island:

  1. PERSIST  — every security verdict becomes a real `Session` row (pathway
                SECURITY_GATE) plus a `RiskEvent`, and a `FraudReport` when the
                verdict is STEP_UP/HARD_BLOCK. That makes it visible in the FIU
                portal's existing Fraud Reports feed with no new UI.

  2. FUSE     — the security risk is combined with the behavioral ML risk using
                a max() floor: a bot-trap or replay attack raises the effective
                risk of the login even when the behavioral model is happy. This
                is the integration that makes the gate actually protective.

  3. ANCHOR   — a security HARD_BLOCK is written to the Hyperledger Fabric
                ledger via the existing behavioral-passport chaincode, signed
                with Dilithium-3. Fabric is best-effort by design (the repo's
                documented degradation path): when the network is unreachable
                the event is still persisted and surfaced, honestly labelled
                on_chain=False rather than being dropped or faked.

Everything here is best-effort and wrapped: a failure in persistence, fusion or
anchoring must never break an authentication request.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.services.threat_level import classify as classify_threat
from app.models.db_models import (
    FraudReport,
    RiskEvent,
    Session as DBSession,
    User,
)

logger = logging.getLogger(__name__)

# Pathway marker so security-gate sessions are distinguishable from ML_FULL
# behavioral sessions in every downstream query (ledger feed, analytics, FIU).
SECURITY_PATHWAY = "SECURITY_GATE"


# ── 2. Fusion ────────────────────────────────────────────────────────────────

def fuse_risk(behavioral_risk: int, security_risk: int) -> int:
    """Combine the behavioral ML risk with the advanced-security gate risk.

    A max() floor rather than a sum: the security modules produce *categorical
    evidence* (a honeypot hit is proof of a bot, a spent nonce is proof of a
    replay), so they establish a lower bound on risk. Summing would let two
    moderate signals manufacture a block, and would also let a clean security
    verdict dilute a genuine behavioral detection. max() does neither.

    Both inputs are on the same 0–1000 scale as the rest of the engine.
    """
    return max(int(behavioral_risk or 0), int(security_risk or 0))


def security_notes_summary(verdicts: dict[str, Any], notes: list[str]) -> str:
    """One-line human summary of a security verdict, for reports and logs."""
    parts = [
        f"deception={verdicts.get('deception_status')}",
        f"replay={verdicts.get('replay_status')}",
        f"pqc={verdicts.get('pqc_shield')}",
        f"zk={verdicts.get('zkp_passport_verified')}",
    ]
    fft = verdicts.get("micro_tremor_fft")
    if isinstance(fft, dict):
        parts.append(f"tremor={fft.get('reason')}")
    tail = f" — {'; '.join(notes)}" if notes else ""
    return ", ".join(parts) + tail


# ── 1. Persistence ───────────────────────────────────────────────────────────

async def persist_security_verdict(
    *,
    session_id: str,
    customer_hash: Optional[str],
    decision: str,
    security_risk: int,
    verdicts: dict[str, Any],
    notes: list[str],
    dilithium_signature: Optional[str],
    pqc_algorithm: Optional[str],
    client_ip: Optional[str] = None,
    channel: str = "internet_banking",
) -> Optional[str]:
    """Write the security verdict to Postgres as a first-class session.

    Returns the persisted session UUID, or None if persistence was skipped.
    The customer is resolved by customer_hash when supplied; anonymous
    pre-auth evaluations (no hash yet) are attributed to a stable synthetic
    'security-gate' principal so the row is never orphaned — the FK to users
    is NOT NULL, and dropping the verdict entirely would be worse than
    attributing it to a clearly-labelled system principal.
    """
    try:
        async with AsyncSessionLocal() as db:
            user = None
            if customer_hash:
                user = (
                    await db.execute(
                        select(User).where(User.customer_hash == customer_hash)
                    )
                ).scalar_one_or_none()

            if user is None:
                # Stable synthetic principal for unattributed gate hits.
                sentinel = "__security_gate__"
                user = (
                    await db.execute(
                        select(User).where(User.customer_hash == sentinel)
                    )
                ).scalar_one_or_none()
                if user is None:
                    from sqlalchemy.dialects.postgresql import insert as pg_insert
                    await db.execute(
                        pg_insert(User)
                        .values(
                            bank_id="SYSTEM",
                            customer_hash=sentinel,
                            name="Security Gate (unattributed)",
                        )
                        .on_conflict_do_nothing(index_elements=["customer_hash"])
                    )
                    await db.flush()
                    user = (
                        await db.execute(
                            select(User).where(User.customer_hash == sentinel)
                        )
                    ).scalar_one_or_none()
                if user is None:
                    return None

            sid = uuid.UUID(session_id) if _is_uuid(session_id) else uuid.uuid4()
            row = DBSession(
                id=sid,
                user_id=user.id,
                channel=channel,
                signal_bundle_json={"cyber_verdicts": verdicts, "notes": notes},
                risk_score=security_risk,
                decision=decision,
                pathway=SECURITY_PATHWAY,
                coercion_probability=0.0,
                latency_ms=0,
                login_ip=client_ip,
                pqc_verified=bool(dilithium_signature),
                pqc_algorithm=pqc_algorithm,
            )
            db.add(row)
            await db.flush()

            db.add(
                RiskEvent(
                    session_id=row.id,
                    trigger_type=_trigger_of(verdicts),
                    score=security_risk,
                    pathway=SECURITY_PATHWAY,
                    shap_explanation={"cyber_verdicts": verdicts, "notes": notes},
                )
            )

            # Surface anything actionable in the existing FIU fraud worklist.
            if decision in ("STEP_UP", "HARD_BLOCK"):
                db.add(
                    FraudReport(
                        session_id=row.id,
                        report_text=(
                            f"Advanced-security gate raised {decision} "
                            f"(risk {security_risk}) — "
                            f"{security_notes_summary(verdicts, notes)}"
                        ),
                        risk_score=security_risk,
                        trigger_signals={
                            "threat_level": classify_threat(security_risk),
                            "evidence": notes or [_trigger_of(verdicts)],
                            "cyber_verdicts": verdicts,
                            "source": "advanced_security_gate",
                        },
                        analyst_action=(
                            "Account hard-blocked by security gate"
                            if decision == "HARD_BLOCK"
                            else "Step-up verification required"
                        ),
                    )
                )

            await db.commit()

            # Tell the live console a verdict landed.
            #
            # The login path publishes session_evaluated and voice MFA
            # publishes voice_mfa, but the advanced-security gate published
            # nothing — so the reports it raises (the bulk of the worklist)
            # only ever surfaced on the next poll. Best-effort: a Redis hiccup
            # must never fail a security verdict that is already committed.
            try:
                from app.core.redis_client import _redis as redis_client
                if redis_client:
                    import json as _json
                    import datetime as _dt
                    await redis_client.publish(
                        "btic:events",
                        _json.dumps({
                            "type": "security_verdict",
                            "session_id": str(row.id),
                            "customer_hash": getattr(user, "customer_hash", None),
                            "decision": decision,
                            "risk_score": security_risk,
                            "channel": channel,
                            "pathway": SECURITY_PATHWAY,
                            "timestamp": _dt.datetime.utcnow().isoformat() + "Z",
                        }),
                    )
            except Exception as pub_exc:  # noqa: BLE001
                logger.debug("btic:events publish skipped: %s", pub_exc)

            return str(row.id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Security verdict persistence failed (non-fatal): %s", exc)
        return None


def _is_uuid(v: str) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _is_hex(v: str) -> bool:
    try:
        int(v, 16)
        return True
    except (ValueError, TypeError):
        return False


def _trigger_of(verdicts: dict[str, Any]) -> str:
    """Most severe module that fired, for the RiskEvent trigger_type."""
    d = str(verdicts.get("deception_status", ""))
    if d in ("TRAP_TRIGGERED", "BLACKLISTED"):
        return "DECEPTION_TRAP"
    r = str(verdicts.get("replay_status", ""))
    if r in ("REPLAY_OR_EXPIRED", "BAD_SIGNATURE"):
        return "REPLAY_ATTACK"
    if verdicts.get("zkp_passport_verified") is False:
        return "ZK_PROOF_INVALID"
    fft = verdicts.get("micro_tremor_fft")
    if isinstance(fft, dict) and fft.get("is_human") is False:
        return "SYNTHETIC_MOTION"

    # Voice MFA. Without these the voice verdicts fell through to
    # SECURITY_GATE_CLEAN, so a HARD_BLOCK was being anchored on-chain and
    # logged as a RiskEvent labelled "CLEAN" — actively misleading in an audit.
    if "voice_mfa" in verdicts:
        if verdicts.get("q1_registered") is False:
            return "VOICE_IDENTITY_DENIED"
        if verdicts.get("q2_not_coerced") is False:
            return "VOICE_COERCION"
        if verdicts.get("q3_location_match") is False:
            return "VOICE_LOCATION_MISMATCH"
        # Login path: caller claimed their usual device, fingerprint disagreed.
        if verdicts.get("q3_location_match") is True and verdicts.get("usual_device") is False:
            return "VOICE_DEVICE_CONTRADICTION"
        if str(verdicts.get("voice_mfa")) in ("NO_ANSWER", "ERROR"):
            return "VOICE_UNREACHABLE"
        return "VOICE_MFA"

    return "SECURITY_GATE_CLEAN"


# ── 3. Blockchain anchoring ──────────────────────────────────────────────────

async def anchor_security_verdict(
    *,
    customer_hash: Optional[str],
    session_id: str,
    decision: str,
    security_risk: int,
    verdicts: dict[str, Any],
    dilithium_signature: Optional[str],
    pqc_algorithm: Optional[str],
) -> dict:
    """Anchor a security HARD_BLOCK to the Fabric ledger, Dilithium-signed.

    Backed by hash_registrar's `RegisterSecurityVerdict` (chaincode v1.1,
    sequence 2) — a purpose-built function, so verdict anchors never collide
    with or pollute the IMEI baselines that drive SIM-swap detection.

    Returns {"on_chain": bool, "reason"/"digest": ...}. Fabric being
    unavailable is an expected, documented state (the repo degrades to an
    off-chain ledger) — it is reported honestly, never faked.
    """
    if decision != "HARD_BLOCK":
        return {"on_chain": False, "reason": "not_a_block"}

    try:
        from app.services.fabric_client import get_fabric_client

        fabric = get_fabric_client()
        if fabric is None:
            return {"on_chain": False, "reason": "fabric_unavailable"}

        # The anchored digest binds the verdict, not any raw telemetry — no PII
        # crosses the chain boundary, consistent with the rest of the design.
        import hashlib
        import json as _json

        digest = hashlib.sha256(
            _json.dumps(
                {
                    "session_id": session_id,
                    "decision": decision,
                    "security_risk": security_risk,
                    "verdicts": {
                        k: (v.get("reason") if isinstance(v, dict) else v)
                        for k, v in verdicts.items()
                    },
                },
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode()
        ).hexdigest()

        # The chaincode validates userHash as hex, so a non-hex customer_hash
        # (demo accounts are plain names like "Harsh") is mapped to a stable
        # salted digest rather than being rejected at the chain boundary.
        raw_id = customer_hash or "__security_gate__"
        user_key = (
            raw_id
            if _is_hex(raw_id) and len(raw_id) <= 128
            else hashlib.sha256(raw_id.encode()).hexdigest()
        )

        res = await fabric.register_security_verdict(
            user_hash=user_key,
            verdict_hash=digest,
            decision=decision,
            risk_score=security_risk,
            trigger=_trigger_of(verdicts),
            signature=dilithium_signature or "",
            algorithm=pqc_algorithm or "Dilithium-3",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        on_chain = res.get("status") != "skipped" and res.get("on_chain") is not False
        return {
            "on_chain": bool(on_chain),
            "digest": digest,
            "user_key": user_key,
            "latency_ms": res.get("latency_ms"),
            "reason": res.get("reason"),
        }
    except Exception as exc:  # noqa: BLE001
        logger.debug("Security verdict anchoring skipped (non-fatal): %s", exc)
        return {"on_chain": False, "reason": str(exc)}
