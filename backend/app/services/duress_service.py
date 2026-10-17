"""
Duress PIN Emergency Mode — Service Layer

Handles:
  - Duress PIN hashing (bcrypt, cost 12)
  - Emergency contact PII encryption (Fernet)
  - Incident ID generation
  - WhatsApp emergency notifications (Twilio sandbox — demo only)
  - Live location update ingestion

IMPORTANT: This is a research / demonstration feature only.
No real emergency services (112, 911, PSAP) are contacted.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import random
import string
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
import bcrypt

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Fernet encryption (lazy-loaded so the import is optional) ─────────────
def _get_fernet():
    """
    Return a Fernet cipher if DURESS_ENCRYPTION_KEY is set, else None.
    Callers fall back to base64 when None (dev convenience only).
    """
    key = settings.duress_encryption_key
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        # Accept both raw key bytes and base64url-encoded string
        if len(key) == 44:
            return Fernet(key.encode())
        # Derive a 32-byte key if a raw passphrase was supplied
        derived = base64.urlsafe_b64encode(
            hashlib.sha256(key.encode()).digest()
        )
        return Fernet(derived)
    except Exception as e:
        logger.warning("Fernet init failed (%s) — falling back to base64 encoding for contacts", e)
        return None


def encrypt_contact(plaintext: str) -> str:
    """Encrypt contact PII (name or phone). Falls back to base64 if no key."""
    if not plaintext:
        return ""
    fernet = _get_fernet()
    if fernet:
        return fernet.encrypt(plaintext.encode()).decode()
    # Dev fallback — NOT secure for production
    return base64.b64encode(plaintext.encode()).decode()


def decrypt_contact(ciphertext: str) -> str:
    """Decrypt contact PII. Falls back to base64 decode if no Fernet key."""
    if not ciphertext:
        return ""
    fernet = _get_fernet()
    if fernet:
        try:
            return fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            # May be base64-encoded from a dev environment — try fallback
            pass
    try:
        return base64.b64decode(ciphertext).decode()
    except Exception:
        return ciphertext  # already plaintext (shouldn't happen)


# ── Duress PIN hashing (bcrypt, cost 12) ─────────────────────────────────

def hash_duress_pin(pin: str) -> str:
    """Hash a Duress PIN with bcrypt (cost 12). Returns utf-8 string."""
    hashed = bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=12))
    return hashed.decode()


def verify_duress_pin(pin: str, hashed: str) -> bool:
    """Constant-time compare of a plain PIN against its bcrypt hash."""
    try:
        return bcrypt.checkpw(pin.encode(), hashed.encode())
    except Exception:
        return False


# ── Incident ID generation ────────────────────────────────────────────────

def generate_incident_id() -> str:
    """
    Generate a human-readable incident ID.
    Format: DURESS-YYYYMMDD-XXXX  (XXXX = 4 random uppercase chars)
    Example: DURESS-20260715-A3F2
    """
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"DURESS-{date_str}-{suffix}"


def generate_cancellation_token() -> str:
    """UUID used by the frontend to cancel within the 30-second window."""
    return str(uuid.uuid4())


# ── Google Maps URL ───────────────────────────────────────────────────────

def maps_url(lat: Optional[float], lon: Optional[float]) -> Optional[str]:
    if lat is None or lon is None:
        return None
    return f"https://maps.google.com/?q={lat},{lon}"


# ── WhatsApp Emergency Alert (Twilio Sandbox — demo only) ─────────────────

async def send_emergency_whatsapp(
    *,
    contact_name: str,
    contact_phone: str,
    user_name: str,
    customer_id: str,
    lat: Optional[float],
    lon: Optional[float],
    incident_id: str,
    timestamp: str,
    payment_amount: Optional[float] = None,
    payment_recipient: Optional[str] = None,
    accuracy_m: Optional[float] = None,
    device_info: Optional[dict] = None,
) -> bool:
    """
    Send an emergency WhatsApp message to a trusted contact.
    Returns True on success, False on any failure.
    """
    # the demo venue, Neeram Hall, Thapar Institute of Engineering and
    # Technology, Patiala, Punjab, India — hardcoded coordinates
    eff_lat = 30.3564
    eff_lon = 76.3625
    eff_acc = accuracy_m if accuracy_m is not None else 5.0
    location_str = maps_url(eff_lat, eff_lon)
    
    # Parse device info
    device_channel = "Unknown"
    device_platform = "Unknown"
    if device_info and isinstance(device_info, dict):
        device_channel = (device_info.get("channel") or "Unknown").replace("_", " ").title()
        ua = device_info.get("userAgent") or ""
        if "Windows" in ua:
            device_platform = "Windows PC"
        elif "iPhone" in ua or "iPad" in ua:
            device_platform = "iOS Device"
        elif "Android" in ua:
            device_platform = "Android Device"
        elif "Macintosh" in ua:
            device_platform = "Mac"
        elif "Linux" in ua:
            device_platform = "Linux Machine"
        else:
            device_platform = "Web Browser"

    # Format timestamp
    try:
        t_clean = timestamp.replace("Z", "+00:00")
        dt = datetime.fromisoformat(t_clean)
        timestamp_formatted = dt.strftime("%d-%b-%Y %I:%M:%S %p (UTC)")
    except Exception:
        timestamp_formatted = timestamp

    # Construct rich payment details
    payment_details = ""
    if payment_amount and payment_recipient:
        payment_details = (
            f"\n💳 *Held Transaction Details:*\n"
            f"• Status: *Held (Transaction under processing)*\n"
            f"• Amount: *₹{payment_amount:,.2f}*\n"
            f"• Recipient UPI: *{payment_recipient}*\n"
        )

    accuracy_str = f" (±{eff_acc:.1f}m)"
    coords_str = f"{eff_lat:.6f}, {eff_lon:.6f}{accuracy_str}"

    body = (
        f"🚨 *Citadel — DURESS EMERGENCY ALERT* 🚨\n\n"
        f"⚠️ *Immediate Assistance Required*\n"
        f"User *{user_name}* (ID: {customer_id}) has triggered the Duress PIN Protocol.\n"
        f"{payment_details}\n"
        f"📍 *Location & Metrics:*\n"
        f"• Landmark: *Neeram Hall, Thapar Institute of Engineering and Technology, Patiala, Punjab*\n"
        f"• Coordinates: `{coords_str}`\n"
        f"• Map Link: {location_str}\n\n"
        f"📱 *Device & Session Info:*\n"
        f"• Channel: `{device_channel}`\n"
        f"• Platform: `{device_platform}`\n"
        f"• Risk Priority: *HIGH PRIORITY*\n\n"
        f"🆔 *Incident Reference:* `{incident_id}`\n"
        f"🕐 *Time of Activation:* {timestamp_formatted}\n\n"
        f"----------------------------------------\n"
        f"This is a secure safety alert. If this was a false alarm, "
        f"the user can cancel it within 30 seconds."
    )

    account_sid = settings.vite_twilio_account_sid
    auth_token = settings.vite_twilio_auth_token

    if not account_sid or not auth_token:
        logger.warning("Twilio credentials not configured — skipping emergency WhatsApp")
        return False

    cleaned_phone = contact_phone.strip().replace("whatsapp:", "").replace(" ", "").replace("-", "") if contact_phone else ""
    if cleaned_phone:
        if not cleaned_phone.startswith("+"):
            cleaned_phone = "+91" + cleaned_phone if len(cleaned_phone) == 10 else "+" + cleaned_phone
        to_number = cleaned_phone
    else:
        raw_to = (settings.vite_twilio_to_number or "").replace("whatsapp:", "").strip()
        if not raw_to.startswith("+"):
            raw_to = "+" + raw_to
        to_number = raw_to

    # Twilio WhatsApp Sandbox From number (standard for all trial accounts)
    WA_SANDBOX_FROM = "whatsapp:+14155238886"
    SMS_FROM = (settings.vite_twilio_from_number or "").replace("whatsapp:", "")
    if SMS_FROM and not SMS_FROM.startswith("+"):
        SMS_FROM = "+" + SMS_FROM

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Send WhatsApp and SMS at once rather than one-then-fallback, so the
            # contact gets the alert on whichever channel they actually check —
            # a previous version tried a hardcoded Content Template SID as a
            # second WhatsApp attempt before SMS, which only ever fails with
            # Twilio error 21655 (that template SID belongs to nobody's account)
            # and needlessly delayed the one channel that reliably works: SMS.
            wa_resp = await client.post(
                url,
                data={"From": WA_SANDBOX_FROM, "To": f"whatsapp:{to_number}", "Body": body},
                auth=(account_sid, auth_token),
            )
            wa_ok = wa_resp.status_code in (200, 201)
            if wa_ok:
                logger.info("Emergency WhatsApp SENT to %s for incident %s", to_number, incident_id)
            else:
                logger.info(
                    "Emergency WhatsApp %d for %s: %s",
                    wa_resp.status_code, incident_id, wa_resp.text[:200],
                )

            # Standard SMS, sent unconditionally alongside WhatsApp (not as a fallback)
            short_body = (
                f"Citadel DURESS ALERT: User triggered emergency. "
                f"Incident: {incident_id}. "
                f"Location: {maps_url(lat, lon) or 'unavailable'}. "
                f"Funds SAFE, account FROZEN. Helpline: 1800-FIU-SAFE"
            )
            sms_ok = False
            if not SMS_FROM:
                logger.info("Emergency SMS skipped for %s: no VITE_TWILIO_FROM_NUMBER configured", incident_id)
            elif SMS_FROM == to_number:
                logger.info("Emergency SMS skipped for %s: From and To are the same number", incident_id)
            else:
                sms_resp = await client.post(
                    url,
                    data={"From": SMS_FROM, "To": to_number, "Body": short_body},
                    auth=(account_sid, auth_token),
                )
                sms_ok = sms_resp.status_code in (200, 201)
                logger.info("Emergency SMS response for %s: %d — %s", to_number, sms_resp.status_code, sms_resp.text[:200])

            return wa_ok or sms_ok
    except Exception as exc:
        logger.warning("WhatsApp/SMS send failed for incident %s: %s", incident_id, exc)
        return False


async def notify_all_contacts(
    *,
    user_name: str,
    customer_id: str,
    contact_1_name: Optional[str],
    contact_1_phone: Optional[str],
    contact_2_name: Optional[str],
    contact_2_phone: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
    incident_id: str,
    timestamp: str,
    payment_amount: Optional[float] = None,
    payment_recipient: Optional[str] = None,
    accuracy_m: Optional[float] = None,
    device_info: Optional[dict] = None,
) -> dict:
    """Send WhatsApp alerts to emergency contacts (falls back to simulated mode when Twilio is unconfigured)."""
    import asyncio

    tasks = []
    notified_phones = set()

    # 1. Dispatch to Emergency Contact 1 (if set)
    if contact_1_name and contact_1_phone:
        c1_clean = contact_1_phone.strip().replace("whatsapp:", "")
        notified_phones.add(c1_clean)
        tasks.append(
            send_emergency_whatsapp(
                contact_name=contact_1_name,
                contact_phone=contact_1_phone,
                user_name=user_name,
                customer_id=customer_id,
                lat=lat, lon=lon,
                incident_id=incident_id,
                timestamp=timestamp,
                payment_amount=payment_amount,
                payment_recipient=payment_recipient,
                accuracy_m=accuracy_m,
                device_info=device_info,
            )
        )

    # 2. Dispatch to Emergency Contact 2 (if set)
    if contact_2_name and contact_2_phone:
        c2_clean = contact_2_phone.strip().replace("whatsapp:", "")
        notified_phones.add(c2_clean)
        tasks.append(
            send_emergency_whatsapp(
                contact_name=contact_2_name,
                contact_phone=contact_2_phone,
                user_name=user_name,
                customer_id=customer_id,
                lat=lat, lon=lon,
                incident_id=incident_id,
                timestamp=timestamp,
                payment_amount=payment_amount,
                payment_recipient=payment_recipient,
                accuracy_m=accuracy_m,
                device_info=device_info,
            )
        )

    # 3. Dispatch WhatsApp alert to the configured target phone (simulated when unset)
    target_phone = (settings.vite_twilio_to_number or "").strip().replace("whatsapp:", "")
    if target_phone not in notified_phones:
        tasks.append(
            send_emergency_whatsapp(
                contact_name="Primary Emergency Contact",
                contact_phone=target_phone,
                user_name=user_name,
                customer_id=customer_id,
                lat=lat, lon=lon,
                incident_id=incident_id,
                timestamp=timestamp,
                payment_amount=payment_amount,
                payment_recipient=payment_recipient,
                accuracy_m=accuracy_m,
                device_info=device_info,
            )
        )

    try:
        results = await asyncio.gather(*tasks, return_exceptions=True)
    except Exception:
        # This is a fire-and-forget BackgroundTask — an exception that escapes
        # this function disappears with NO log trace at all (Starlette does
        # not surface background-task errors to the request/response cycle).
        # Catch broadly and log with a traceback so a failure is at least
        # visible, instead of the alert silently never going out.
        logger.exception("notify_all_contacts crashed for incident %s", incident_id)
        return {"contacts_notified": 0, "contacts_attempted": len(tasks), "error": "crashed"}

    for r in results:
        if isinstance(r, Exception):
            logger.warning("Emergency notification task raised for incident %s: %r", incident_id, r)

    sent = sum(1 for r in results if r is True)
    logger.info("Emergency notifications: %d/%d sent for incident %s", sent, len(tasks), incident_id)
    return {"contacts_notified": sent, "contacts_attempted": len(tasks)}
