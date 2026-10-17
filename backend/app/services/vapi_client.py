"""
Citadel — Vapi voice-MFA client
===================================

Places an outbound verification call at registration and asks three yes/no
questions. Follows the same posture as `notifier.py`: when credentials are
absent the call is SIMULATED — the exact assistant payload is still built and
recorded, so the whole flow is demonstrable end to end without burning credits
or needing a live phone.

Why these three questions
-------------------------
The call goes to the number entered during registration, so the attack it
defends against is: *someone registers using a victim's identity and the
victim's phone number*. The victim answers and says "I did not register" — and
the account is stopped before it exists.

A question must never leak its own answer. "Is your emergency contact Rahul?"
tells an attacker the contact's name, so knowledge questions of that shape are
deliberately not used. All three below are safe to ask aloud.

    Q1 registered      "Did you just create a ZipPay Bank account?"
                       FALSE ⇒ identity theft            ⇒ HARD_BLOCK
    Q2 not_coerced     "Are you doing this on your own?"
                       FALSE ⇒ coercion / remote coaching ⇒ HARD_BLOCK
    Q3 location_match  "Are you currently in <city>?"
                       FALSE ⇒ geo mismatch               ⇒ STEP_UP

Q2 is the one that matters most for Indian retail banking fraud, where the
dominant vector is a scammer walking the victim through the flow on another
call. It maps onto the coercion pathway the risk engine already models.

A dropped or unanswered call is STEP_UP, never a block — a customer must not be
locked out by a bad mobile network.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

VAPI_BASE = "https://api.vapi.ai"

# Risk contributions, on the same 0–1000 scale as the rest of the engine.
RISK_IDENTITY_THEFT = 1000   # Q1 failed
RISK_COERCION = 1000         # Q2 failed
RISK_GEO_MISMATCH = 450      # Q3 failed → STEP_UP band
RISK_NO_ANSWER = 450         # unreachable → STEP_UP, never a block
RISK_CLEAN = 0


def is_configured() -> bool:
    """True when real outbound calls can be placed."""
    return bool(
        settings.vapi_enabled
        and settings.vapi_private_key
        and settings.vapi_phone_number_id
    )


@dataclass
class CallResult:
    ok: bool
    call_id: Optional[str] = None
    simulated: bool = False
    reason: Optional[str] = None
    assistant: dict = field(default_factory=dict)


# ── Assistant definition ─────────────────────────────────────────────────────

def build_assistant(
    name: str,
    city: Optional[str],
    purpose: str = "registration",
    usual_device: bool = True,
) -> dict:
    """
    Inline Vapi assistant for one verification call.

    Built inline rather than referencing a stored assistantId because every
    call is personalised (customer name, registered city) — inline keeps the
    exact wording that was asked auditable alongside the answers.

    `purpose` switches the question set:

      registration — confirms a NEW account was opened deliberately.
      login        — confirms THIS sign-in was the customer's own. Question 3
                     becomes a device question rather than a city one, because
                     at login the device fingerprint is already known: we are
                     not asking to learn the answer, we are checking whether
                     what the caller says CONTRADICTS what the sensors saw.
                     `usual_device` carries that sensor truth so the caller's
                     reply can be compared against it downstream.
    """
    display_name = (name or "there").strip().split(" ")[0]
    # Q3 needs a city. Without one it is skipped rather than asked about
    # "unknown", which would confuse the customer and produce a junk answer.
    has_city = bool(city and city.strip() and city.strip().lower() != "unknown")
    city_label = (city or "").strip()

    is_login = purpose == "login"

    if is_login:
        # At login the third question is a CONTRADICTION check, not a fact we
        # need to learn — the device fingerprint already told us the answer.
        # An attacker on a swapped SIM will confidently say "yes, my usual
        # device" while the fingerprint says otherwise; that mismatch is the
        # detection. Phrased so TRUE always means "usual device".
        q1_text = '1. "Did you just sign in to your ZipPay Bank account?"'
        q3_line = '3. "Are you signing in from the same phone or computer you normally use?"'
        q3_desc = "True if the caller says they are on their usual device."
        context_line = "who has just signed in to their ZipPay Bank account"
        why_calling = "It is a routine security check on the sign-in that just happened."
        first_message = (
            f"Hey {display_name}, this is the ZipPay Bank security team. "
            f"We noticed a sign-in to your account just now. "
            f"I just need to confirm a couple of things — "
            f"you can answer with a simple yes or no."
        )
    else:
        # Q3 needs a city. Without one it is skipped rather than asked about
        # "unknown", which would confuse the customer and produce a junk answer.
        q1_text = '1. "Did you just create a new ZipPay Bank account in the last few minutes?"'
        # With no city on file there is nothing meaningful to ask, so a third
        # question is substituted rather than leaving a "skip" instruction in
        # the list. A skip instruction sitting among the questions caused the
        # model to treat the WHOLE block as skippable and end the call after
        # the greeting, asking nothing at all.
        q3_line = (
            f'3. "Are you currently in {city_label}?"'
            if has_city
            else '3. "Are you setting this account up on your own personal device?"'
        )
        q3_desc = f"True if the caller confirmed they are currently in {city_label}. Null if not asked."
        context_line = "who has just registered for a new ZipPay Bank account"
        why_calling = "It is a routine security check on your new account."
        first_message = (
            f"Hey {display_name}, this is the ZipPay Bank security team. "
            f"Thanks for registering with us. "
            f"I just need to confirm three quick things to secure your account — "
            f"you can answer with a simple yes or no."
        )

    system_prompt = f"""You are the ZipPay Bank security verification assistant.
You are calling {display_name}, {context_line}.

YOUR TASK: read out EVERY question in the list below, one at a time, and get an
answer to each one. This is the entire purpose of the call.

MANDATORY RULES — follow these exactly:
- You MUST speak each question out loud, word for word, in order.
- You MUST wait for the customer to answer before asking the next one.
- NEVER skip a question. NEVER assume an answer.
- If the customer answers early, says "yes" several times, or tries to rush you,
  you STILL ask every remaining question individually. Say
  "Just to confirm each one separately —" and continue.
- Do NOT say "that is everything I needed" until you have asked EVERY question
  in the list and received an answer to each.
- Accept natural answers ("yeah", "nope", "correct", "that's right") as yes/no.
- If an answer is unclear, re-ask ONCE in simpler words, then move on.
- Be brief and professional. Never reveal account details, PINs or passwords,
  and never ask for them.
- If asked why you are calling: "{why_calling}"
- Do not invent extra questions.

THE QUESTIONS — ask all of them:
{q1_text}
2. "Are you doing this on your own — is there anyone guiding you or telling you what to do right now?"
   For this one, "no one is guiding me" is the SAFE answer.
   Record q2_not_coerced = true when they are acting alone,
   false if anyone is instructing them.
{q3_line}

Only after every question above has been asked and answered, say
"That is everything I needed, thank you." and end the call."""

    return {
        "firstMessage": first_message,
        "model": {
            "provider": "openai",
            "model": "gpt-4o",
            "temperature": 0.3,
            "messages": [{"role": "system", "content": system_prompt}],
        },
        "voice": {"provider": "vapi", "voiceId": "Neha"},
        "firstMessageMode": "assistant-speaks-first",
        "maxDurationSeconds": 180,
        "endCallMessage": "Thank you. Your account is now secured. Goodbye.",
        # Structured extraction is what the webhook reads — it turns a free-form
        # conversation into the three booleans the risk engine needs.
        "analysisPlan": {
            "structuredDataPlan": {
                "enabled": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "q1_registered": {
                            "type": "boolean",
                            "description": "True if the caller confirmed they just created a ZipPay Bank account.",
                        },
                        "q2_not_coerced": {
                            "type": "boolean",
                            "description": "True if the caller is acting ALONE with nobody instructing them. False if anyone is guiding or coaching them.",
                        },
                        "q3_location_match": {
                            "type": ["boolean", "null"],
                            "description": q3_desc,
                        },
                        "answered_all": {
                            "type": "boolean",
                            "description": "True if the caller answered every question that was asked.",
                        },
                    },
                    "required": ["q1_registered", "q2_not_coerced"],
                },
            },
            "summaryPlan": {"enabled": True},
        },
    }


# ── Outbound call ────────────────────────────────────────────────────────────

async def place_verification_call(
    *,
    phone_number: str,
    name: str,
    city: Optional[str],
    metadata: Optional[dict[str, Any]] = None,
) -> CallResult:
    """
    Place the outbound verification call.

    Returns CallResult(ok, call_id, simulated). Never raises — a telephony
    outage must not take down registration; the caller decides the fallback
    (which is STEP_UP, not block).
    """
    assistant = build_assistant(name, city)

    if not is_configured():
        # Simulated mode: no credentials, so no billable call. The payload is
        # still built and returned so the flow, the UI and the audit record are
        # all exercised exactly as they would be in production.
        sim_id = f"sim-{uuid.uuid4().hex[:16]}"
        logger.info("Vapi not configured — simulating verification call %s", sim_id)
        return CallResult(ok=True, call_id=sim_id, simulated=True, assistant=assistant)

    payload: dict[str, Any] = {
        "phoneNumberId": settings.vapi_phone_number_id,
        "customer": {"number": phone_number},
        "assistant": assistant,
    }
    if settings.vapi_server_url:
        payload["assistant"]["server"] = {
            "url": settings.vapi_server_url.rstrip("/") + "/api/voice-mfa/webhook",
            **({"secret": settings.vapi_webhook_secret} if settings.vapi_webhook_secret else {}),
        }
    if metadata:
        payload["metadata"] = metadata

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{VAPI_BASE}/call",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.vapi_private_key}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code >= 400:
            logger.warning("Vapi call rejected (%s): %s", resp.status_code, resp.text[:300])
            return CallResult(ok=False, reason=f"vapi_http_{resp.status_code}", assistant=assistant)

        data = resp.json()
        call_id = data.get("id")
        logger.info("Vapi verification call placed: %s → %s", call_id, phone_number[-4:])
        return CallResult(ok=True, call_id=call_id, assistant=assistant)

    except Exception as exc:  # noqa: BLE001
        logger.warning("Vapi call failed (non-fatal): %s", exc)
        return CallResult(ok=False, reason=str(exc), assistant=assistant)


async def fetch_call(call_id: str) -> Optional[dict]:
    """Read a call back from Vapi — the polling fallback if no webhook lands."""
    if not is_configured() or call_id.startswith("sim-"):
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{VAPI_BASE}/call/{call_id}",
                headers={"Authorization": f"Bearer {settings.vapi_private_key}"},
            )
        return resp.json() if resp.status_code < 400 else None
    except Exception as exc:  # noqa: BLE001
        logger.debug("Vapi call fetch failed: %s", exc)
        return None


# ── Verdict ──────────────────────────────────────────────────────────────────

RISK_CONTRADICTION = 1000   # what the caller said conflicts with the sensors


def evaluate_answers(
    q1: Optional[bool],
    q2: Optional[bool],
    q3: Optional[bool],
    purpose: str = "registration",
    usual_device: Optional[bool] = None,
) -> tuple[int, str, Optional[str]]:
    """
    Map the answers to (risk_score, decision, failure_reason).

    Ordering is deliberate — the most serious finding wins, and an unreachable
    customer is never treated as a fraudster.

    On the LOGIN path, question 3 is cross-checked against the device
    fingerprint rather than taken at face value. `usual_device` is what the
    sensors saw; q3 is what the caller claimed. Agreement is fine either way —
    a customer on a genuinely new device who SAYS it is new is being honest and
    only earns a step-up. The dangerous case is the caller insisting it is
    their usual device when the fingerprint says otherwise, which is what a
    SIM-swap attacker does.
    """
    if q1 is False:
        return (
            RISK_IDENTITY_THEFT, "HARD_BLOCK",
            "customer denied signing in — possible account takeover"
            if purpose == "login"
            else "customer denied registering — possible identity theft",
        )
    if q2 is False:
        return RISK_COERCION, "HARD_BLOCK", "customer reported being guided by someone — possible coercion"
    if q1 is None and q2 is None:
        return RISK_NO_ANSWER, "STEP_UP", "call not answered or no questions completed"

    if purpose == "login":
        if q3 is True and usual_device is False:
            return (
                RISK_CONTRADICTION, "HARD_BLOCK",
                "caller claims their usual device but the device fingerprint does not match",
            )
        if q3 is False:
            # Honest about a new device — plausible, so step up rather than block.
            return RISK_GEO_MISMATCH, "STEP_UP", "signing in from a device the customer says is not their usual one"
    elif q3 is False:
        return RISK_GEO_MISMATCH, "STEP_UP", "customer not in the city the registration came from"

    if q1 is None or q2 is None:
        return RISK_NO_ANSWER, "STEP_UP", "call ended before all questions were answered"
    return RISK_CLEAN, "APPROVE", None
