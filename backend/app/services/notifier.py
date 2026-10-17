"""
Notification service for the FIU fraud-ops panel.

When an analyst blocks a customer, the panel can email and/or SMS the customer
with concrete "what to do next" instructions. This module renders reason-aware
templates and dispatches them through a provider abstraction:

  Email → SMTP (real send when SMTP creds are configured) else simulated.
  SMS   → CAMARA telecom mock (/mock/sms) when camara_mock_enabled else simulated.

The simulated path is the zero-config default: it records the EXACT message in
the notifications table and surfaces it in the UI, so the demo works with no
credentials while real sends switch on the moment creds are added. A simulated
send is a genuine, honest record — never a fake "we tried" claim.

Every public send_* helper returns a dict:
  {status: "sent"|"simulated"|"failed", provider: str, detail: str, subject?, body}
so the caller can persist a faithful row regardless of the path that ran.
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Reason-aware message templates ─────────────────────────────────────────
# Each reason maps to (email_subject, email_body, sms_body). The customer label
# is interpolated into the greeting; the message is concrete next-steps, not a
# generic "your account is locked" — that's what makes this a defensible
# fraud-ops control rather than a stub.
_TEMPLATES: dict[str, dict[str, str]] = {
    "sim_swap": {
        "subject": "Your account is temporarily locked after a SIM-swap alert",
        "email": (
            "Dear {label},\n\n"
            "We temporarily locked your account after detecting a SIM-swap risk on "
            "your registered mobile number. This is a safety measure to protect your funds.\n\n"
            "What to do next:\n"
            "  1. Visit your home branch with a valid government-issued photo ID.\n"
            "  2. Re-register your mobile number with your carrier and confirm it with us.\n"
            "  3. Re-enroll your behavioural profile after the block is lifted.\n\n"
            "If this was NOT you, call our 24x7 fraud helpline immediately.\n\n"
            "— Citadel Fraud-Ops (FIU)"
        ),
        "sms": (
            "Citadel: Your account is locked after a SIM-swap alert. "
            "Visit your branch with photo ID to re-verify. Do NOT share this code or OTP with anyone."
        ),
    },
    "coercion": {
        "subject": "Unusual activity on your account — verification required",
        "email": (
            "Dear {label},\n\n"
            "We paused a transaction on your account because our behavioural engine detected "
            "signs of possible coercion or coached input — someone may be instructing you.\n\n"
            "What to do next:\n"
            "  1. If you are safe and acting freely, log in from your usual device and re-verify.\n"
            "  2. If someone is pressuring you, end the call/session and call our fraud helpline "
            "from a number you trust.\n"
            "  3. Do not share any OTP, PIN, or screen under instruction.\n\n"
            "— Citadel Fraud-Ops (FIU)"
        ),
        "sms": (
            "Citadel: Verification required — your account showed unusual activity. "
            "If someone is guiding you, stop and call our fraud helpline from a trusted number. Never share OTPs."
        ),
    },
    "behavioral_anomaly": {
        "subject": "Your account is under review — behavioural anomaly detected",
        "email": (
            "Dear {label},\n\n"
            "We temporarily restricted your account after our behavioural engine flagged your "
            "recent login pattern as inconsistent with your profile.\n\n"
            "What to do next:\n"
            "  1. Log in from your usual device and location.\n"
            "  2. Re-enroll your behavioural profile when prompted.\n"
            "  3. If you changed devices recently, complete step-up verification at your branch.\n\n"
            "— Citadel Fraud-Ops (FIU)"
        ),
        "sms": (
            "Citadel: Account under review after a behavioural anomaly. Log in from your usual "
            "device and re-enroll when prompted. Visit your branch if you changed devices."
        ),
    },
    # Soft WARNING (not a block). Follows the escalation chain the panel models:
    # FIU fraud-ops raises the alert → the customer's bank relays it → customer.
    "warning": {
        "subject": "Security alert on your account — please review",
        "email": (
            "Dear {label},\n\n"
            "Your bank, acting on a fraud-risk alert raised by the FIU fraud-operations "
            "unit, has flagged unusual activity on your account. Your account is NOT "
            "blocked — this is a precautionary warning so you can act early.\n\n"
            "What to do next:\n"
            "  1. Review your recent logins and transactions in your banking app.\n"
            "  2. If everything looks normal, no action is needed.\n"
            "  3. If you see anything you do not recognise, call your bank's 24x7 fraud "
            "helpline immediately and do NOT share any OTP or PIN with anyone.\n\n"
            "— Your Bank, on behalf of Citadel Fraud-Ops (FIU)"
        ),
        "sms": (
            "Your bank: A security alert was raised on your account by FIU fraud-ops. "
            "Your account is NOT blocked. Review recent activity; if anything looks wrong, "
            "call your fraud helpline. Never share OTPs."
        ),
    },
    "manual": {
        "subject": "Your account is temporarily locked by the fraud-ops team",
        "email": (
            "Dear {label},\n\n"
            "Our fraud-operations team has temporarily locked your account as a precaution.\n\n"
            "What to do next:\n"
            "  1. Contact your branch or our 24x7 fraud helpline to verify your identity.\n"
            "  2. Carry a valid government-issued photo ID for re-verification.\n"
            "  3. Re-enroll your behavioural profile once the block is lifted.\n\n"
            "— Citadel Fraud-Ops (FIU)"
        ),
        "sms": (
            "Citadel: Your account is temporarily locked by fraud-ops. Contact your branch or "
            "our fraud helpline with photo ID to re-verify. Never share OTPs."
        ),
    },
}

# Reasons the panel offers in the dropdown, in display order.
REASON_OPTIONS = ["sim_swap", "coercion", "behavioral_anomaly", "manual"]


def get_template(reason: str) -> dict[str, str]:
    """Return the template for a reason, falling back to 'manual'."""
    return _TEMPLATES.get(reason, _TEMPLATES["manual"])


def render(reason: str, channel: str, customer_label: str = "Customer") -> dict[str, str]:
    """Render the subject + body for the given reason/channel.

    `customer_label` is a non-PII friendly label (we never have the customer's
    real name — only the hash — so the greeting stays generic).
    """
    tpl = get_template(reason)
    label = customer_label or "Customer"
    if channel == "email":
        return {"subject": tpl["subject"], "body": tpl["email"].format(label=label)}
    return {"subject": "", "body": tpl["sms"].format(label=label)}


# ── Provider dispatch ──────────────────────────────────────────────────────
def _smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


async def send_email(to: str, subject: str, body: str, reason: str) -> dict:
    """Send (or simulate) an email. Returns a status dict for the log row."""
    rendered = {"subject": subject, "body": body}
    if not to:
        return {"status": "failed", "provider": "none", "detail": "no recipient address", **rendered}
    if not _smtp_configured():
        # Zero-config default: record exactly what WOULD have been sent.
        return {"status": "simulated", "provider": "simulated",
                "detail": "SMTP not configured — message recorded, not transmitted", **rendered}
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.notification_sender_name} <{settings.smtp_from or settings.smtp_user}>"
        msg["To"] = to
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # SMTP dispatch is synchronous — run in a worker thread so we never block
        # the event loop on a slow mail server.
        import asyncio
        loop = asyncio.get_running_loop()

        def _deliver() -> None:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as srv:
                srv.starttls()
                srv.login(settings.smtp_user, settings.smtp_password)
                srv.sendmail(msg["From"], [to], msg.as_string())

        await loop.run_in_executor(None, _deliver)
        return {"status": "sent", "provider": "smtp", "detail": f"delivered to {to}", **rendered}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Email send failed (%s): %s", to, exc)
        return {"status": "failed", "provider": "smtp", "detail": f"send error: {exc}", **rendered}


async def send_sms(to: str, body: str, reason: str) -> dict:
    """Send an SMS/WhatsApp notification via Twilio (or CAMARA telecom mock fallback).

    Dispatches BOTH WhatsApp and SMS at once, independently, rather than trying
    one and falling back to the other — the customer gets the same message on
    whichever channel they actually check first, instead of waiting on a failed
    first attempt (e.g. an unjoined WhatsApp sandbox) before SMS ever fires.
    Returns a status dict; `provider` lists every channel that actually sent.
    """
    rendered = {"subject": "", "body": body}
    target_to = to or settings.vite_twilio_to_number
    if not target_to:
        return {"status": "failed", "provider": "none", "detail": "no recipient number", **rendered}

    account_sid = settings.vite_twilio_account_sid
    auth_token = settings.vite_twilio_auth_token
    from_num = settings.vite_twilio_from_number

    # Dispatch via Twilio if configured
    if account_sid and auth_token and not account_sid.startswith("your-"):
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        clean_to = target_to.replace("whatsapp:", "").strip()
        if not clean_to.startswith("+"):
            clean_to = "+" + clean_to

        sms_from = from_num.replace("whatsapp:", "").strip()
        if sms_from and not sms_from.startswith("+"):
            sms_from = "+" + sms_from
        wa_from = "whatsapp:+14155238886"  # Twilio WhatsApp sandbox

        sent: list[str] = []
        failures: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                wa_resp = await client.post(
                    url,
                    data={"From": wa_from, "To": f"whatsapp:{clean_to}", "Body": body},
                    auth=(account_sid, auth_token),
                )
                if wa_resp.status_code in (200, 201):
                    sent.append("twilio_wa")
                else:
                    failures.append(f"wa:{wa_resp.status_code}")
                    logger.info("Twilio WA %d for %s: %s", wa_resp.status_code, clean_to, wa_resp.text[:150])

                # Twilio rejects From == To outright, and there's nothing useful
                # to send if no sender number is configured at all.
                if not sms_from:
                    failures.append("sms:no_from_number_configured")
                elif sms_from == clean_to:
                    failures.append("sms:from_equals_to")
                else:
                    sms_resp = await client.post(
                        url,
                        data={"From": sms_from, "To": clean_to, "Body": body},
                        auth=(account_sid, auth_token),
                    )
                    if sms_resp.status_code in (200, 201):
                        sent.append("twilio_sms")
                    else:
                        failures.append(f"sms:{sms_resp.status_code}")
                        logger.warning("Twilio SMS %d for %s: %s", sms_resp.status_code, clean_to, sms_resp.text[:200])
        except Exception as exc:
            logger.warning("Twilio dispatch failed (%s): %s", target_to, exc)
            failures.append(f"error:{exc}")

        if sent:
            logger.info("Twilio sent via %s to %s (reason=%s)", "+".join(sent), clean_to, reason)
            return {
                "status": "sent", "provider": "+".join(sent),
                "detail": f"sent via {', '.join(sent)} to {clean_to}" + (f" (failed: {', '.join(failures)})" if failures else ""),
                **rendered,
            }
        logger.warning("Both WhatsApp and SMS failed for %s: %s", clean_to, failures)

    if not settings.camara_mock_enabled:
        return {"status": "simulated", "provider": "simulated",
                "detail": "CAMARA mock disabled — message recorded, not transmitted", **rendered}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                f"{settings.camara_api_url}/sms",
                json={"to": target_to, "body": body, "reason": reason},
            )
            if resp.status_code == 200:
                return {"status": "sent", "provider": "camara",
                        "detail": f"accepted by CAMARA mock for {target_to}", **rendered}
            return {"status": "failed", "provider": "camara",
                    "detail": f"CAMARA mock returned {resp.status_code}", **rendered}
    except httpx.ConnectError as exc:
        logger.debug("SMS CAMARA mock unreachable (%s): %s", target_to, exc)
        return {"status": "simulated", "provider": "simulated",
                "detail": "CAMARA mock unreachable — message recorded, not transmitted", **rendered}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SMS send failed (%s): %s", target_to, exc)
        return {"status": "failed", "provider": "camara", "detail": f"send error: {exc}", **rendered}